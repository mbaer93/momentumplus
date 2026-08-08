/*
 * Measured contrast audit. Renders each route in Chromium and computes the
 * EFFECTIVE contrast of every text node — resolving the cascade, cumulative
 * opacity, and the real composited background — then replays every
 * :hover / :focus / :disabled / ::placeholder rule against the elements it
 * would actually apply to.
 *
 * This is the part a stylesheet parser cannot do: opacity dimming, inline
 * styles, Tailwind utilities, and specificity are all resolved by the engine.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

/*
 * Usage: start a preview build (npm run build && npm run start with empty
 * Supabase env + ALLOW_UNCONFIGURED_PREVIEW=1), then:
 *   node scripts/contrast-audit.mjs
 * Exits non-zero when anything fails, so it can gate a future CI job.
 */

// .wm-sub is a rendered sponsor wordmark — a logotype, exempt from 1.4.3,
// and sponsor-facing, so it is Matt's call rather than a code fix.
const ALLOWED = 1;
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const ROUTES = [
  "/", "/join", "/login", "/terms", "/privacy", "/start",
  "/dashboard", "/sessions", "/calendar", "/library", "/community",
  "/speakers", "/sponsors", "/resources", "/education", "/podcast",
  "/services", "/rooted-focus", "/profile", "/upgrade", "/expired",
  "/notifications", "/search", "/directory", "/referrals",
  "/speaker", "/sponsor", "/welcome", "/admin",
];

const AUDIT = () => {
  // ---- colour maths -------------------------------------------------
  const parse = (c) => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+))?/.exec(c);
    if (!m) return null;
    return [ +m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4] ];
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [0,1,2].map(i => fg[i]*a + bg[i]*(1-a)).concat(1);
  };
  const lum = (c) => {
    const f = (x) => { x/=255; return x<=0.03928 ? x/12.92 : ((x+0.055)/1.055)**2.4; };
    return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]);
  };
  const ratio = (a, b) => {
    let x = lum(a), y = lum(b);
    if (x < y) [x,y] = [y,x];
    return (x + .05) / (y + .05);
  };

  const sel = (el) => {
    const bits = [];
    let n = el, depth = 0;
    while (n && n.nodeType === 1 && depth++ < 4) {
      let s = n.tagName.toLowerCase();
      if (n.classList.length) s += "." + [...n.classList].slice(0,3).join(".");
      bits.unshift(s);
      n = n.parentElement;
    }
    return bits.join(" > ");
  };

  // Composite background behind an element, walking ancestors through
  // transparent layers. Returns null when a gradient/image intervenes
  // (can't be reduced to one colour — flagged separately, not guessed).
  const bgOf = (el) => {
    let layers = [], n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { gradient: true };
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] === 1) break;
      }
      n = n.parentElement;
    }
    let base = [255,255,255,1];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return { color: base };
  };

  const opacityOf = (el) => {
    let o = 1, n = el;
    while (n && n.nodeType === 1) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!Number.isNaN(v)) o *= v;
      n = n.parentElement;
    }
    return o;
  };

  const threshold = (cs) => {
    const px = parseFloat(cs.fontSize);
    const w = parseInt(cs.fontWeight, 10) || 400;
    const large = px >= 24 || (px >= 18.66 && w >= 700);
    return large ? 3.0 : 4.5;
  };

  const hasOwnText = (el) =>
    [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);

  const out = [];
  const seen = new Set();
  const push = (rec) => {
    const k = `${rec.state}|${rec.sel}|${rec.ratio.toFixed(2)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(rec);
  };

  // ---- pass 1: rendered text ----------------------------------------
  for (const el of document.querySelectorAll("*")) {
    if (!hasOwnText(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    const op = opacityOf(el);
    if (op < 0.05) continue;              // effectively invisible on purpose
    const fg = parse(cs.color);
    const bg = bgOf(el);
    if (!fg || bg.gradient) continue;

    // Cumulative opacity dims the TEXT against its backdrop — this is the
    // class of defect a stylesheet parser cannot see.
    const eff = over([fg[0], fg[1], fg[2], fg[3] * op], bg.color);
    const cr = ratio(eff, bg.color);
    const need = threshold(cs);
    if (cr < need) {
      push({
        state: op < 1 ? `opacity ${op.toFixed(2)}` : "rendered",
        sel: sel(el),
        ratio: cr, need,
        color: cs.color, opacity: op,
        text: el.textContent.trim().slice(0, 40),
      });
    }
  }

  // ---- pass 2: pseudo-states replayed --------------------------------
  // :hover / :focus / :disabled / ::placeholder never appear in a static
  // render, so each such rule is applied to the elements it targets and the
  // resulting colour measured against their real background.
  const PSEUDO = /(:hover|:focus(-visible)?|:disabled|::placeholder|\.disabled|\[disabled\])/;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.selectorText || !PSEUDO.test(rule.selectorText)) continue;
        const col = rule.style?.getPropertyValue("color");
        if (!col) continue;
        for (const part of rule.selectorText.split(",")) {
          const p = part.trim();
          if (!PSEUDO.test(p)) continue;
          const base = p.replace(/::?(hover|focus(-visible)?|disabled|placeholder)/g, "")
                        .replace(/\[disabled\]/g, "").replace(/\.disabled/g, "").trim();
          if (!base) continue;
          let els;
          try { els = document.querySelectorAll(base); } catch { continue; }
          for (const el of [...els].slice(0, 4)) {
            const cs = getComputedStyle(el);
            const bg = bgOf(el);
            if (bg.gradient) continue;
            // Resolve the declared colour through a throwaway element so
            // var() and keywords resolve the same way the engine would.
            const probe = document.createElement("span");
            probe.style.color = col;
            el.appendChild(probe);
            const resolved = parse(getComputedStyle(probe).color);
            probe.remove();
            if (!resolved) continue;
            const op = opacityOf(el);
            const eff = over([resolved[0],resolved[1],resolved[2],resolved[3]*op], bg.color);
            const cr = ratio(eff, bg.color);
            const need = threshold(cs);
            if (cr < need) {
              push({
                state: p.match(PSEUDO)[0],
                sel: `${base}  {${p.match(PSEUDO)[0]}}`,
                ratio: cr, need, color: col, opacity: op,
                text: el.textContent.trim().slice(0, 40),
              });
            }
          }
        }
      }
    };
    walk(rules);
  }
  return out;
};

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const all = [];
for (const route of ROUTES) {
  try {
    const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 20000 });
    if (!res || res.status() >= 400) { console.error(`skip ${route} (${res?.status()})`); continue; }
    const found = await page.evaluate(AUDIT);
    for (const f of found) all.push({ route, ...f });
    console.error(`${route}: ${found.length}`);
  } catch (e) {
    console.error(`skip ${route} (${String(e).split("\n")[0].slice(0,60)})`);
  }
}
await browser.close();

// Dedupe across routes by selector+state, keeping the worst ratio.
const byKey = new Map();
for (const f of all) {
  const k = `${f.state}|${f.sel}`;
  const prev = byKey.get(k);
  if (!prev || f.ratio < prev.ratio) byKey.set(k, f);
}
const uniq = [...byKey.values()].sort((a, b) => a.ratio - b.ratio);
writeFileSync("contrast-report.json", JSON.stringify(uniq, null, 2));
console.log(`\n=== ${uniq.length} unique failing states (${all.length} occurrences) ===\n`);
for (const f of uniq) {
  console.log(`${f.ratio.toFixed(2)}:1 (need ${f.need})  [${f.state}]  ${f.route}`);
  console.log(`    ${f.sel}`);
  console.log(`    color:${f.color}  opacity:${f.opacity.toFixed(2)}  "${f.text}"`);
}

process.exit(uniq.length > ALLOWED ? 1 : 0);

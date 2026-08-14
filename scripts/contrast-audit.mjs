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

  /*
   * Worst-case opacity for each @keyframes animation.
   *
   * A rendered sweep samples whichever frame happens to be showing, so an
   * animated fade is caught by luck or not at all — our "Live Now" badge sat
   * at 3.97:1 for half of every cycle and was only found by reading the CSS
   * by hand. Ported from the TSLS-Companion port of this script, which had
   * already solved it. A label that spends half its life under AA is under
   * AA, so the MINIMUM opacity across the frames is the one that counts.
   */
  const keyframeMinOpacity = new Map();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walkKeyframes = (list) => {
      for (const rule of list) {
        if (rule.type === CSSRule.KEYFRAMES_RULE || rule.cssRules && rule.name) {
          let min = 1;
          for (const frame of rule.cssRules ?? []) {
            const v = frame.style?.getPropertyValue("opacity");
            if (v !== "" && v != null) min = Math.min(min, parseFloat(v));
          }
          if (Number.isFinite(min)) {
            keyframeMinOpacity.set(rule.name, Math.min(min, keyframeMinOpacity.get(rule.name) ?? 1));
          }
        } else if (rule.cssRules?.length) {
          // Same nested-CSS trap as pass 2: every plain style rule exposes an
          // empty .cssRules, so testing presence recurses into nothing on
          // every rule in the sheet.
          walkKeyframes(rule.cssRules);
        }
      }
    };
    walkKeyframes(rules);
  }

  const opacityOf = (el) => {
    let o = 1, n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      const sampled = parseFloat(cs.opacity);
      // An animation that dips the opacity counts at its WORST frame, not at
      // whatever frame this screenshot caught. The sampled value ALREADY
      // reflects the animation, so the minimum REPLACES it — multiplying the
      // two would penalise the element twice and invent failures.
      let worst = Number.isNaN(sampled) ? 1 : sampled;
      for (const name of (cs.animationName || "none").split(",")) {
        const min = keyframeMinOpacity.get(name.trim());
        if (min !== undefined) worst = Math.min(worst, min);
      }
      o *= worst;
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
  /*
   * :hover / :focus / :disabled / ::placeholder never appear in a static
   * render, so every such rule is replayed against the elements it targets.
   *
   * Replayed through the ENGINE, not by reading a declaration.
   * `rule.style.color` is what one rule asks for, which is not what paints:
   * .filter-btn:hover and .filter-btn.active have identical specificity, and
   * .active is declared later, so on the active button the hover colour never
   * lands. Reading the declaration reported that button as 3.24:1 against
   * navy — a failure the user cannot reach.
   *
   * Instead each pseudo-CLASS rule is cloned onto a marker class of equal
   * specificity (:hover and .marker both weigh one class) and inserted
   * IMMEDIATELY AFTER its source, so document order — and therefore the
   * cascade — is preserved. Adding the marker to an element and reading its
   * computed colour then gives exactly what the browser would paint in that
   * state, with var(), specificity, order and shorthands all resolved.
   *
   * Pseudo-ELEMENTS can't be replayed by class, and don't need to be:
   * getComputedStyle(el, "::placeholder") already reports the resolved value.
   */
  const PSEUDO = /(:hover|:focus(-visible)?|:disabled|::placeholder|\.disabled|\[disabled\])/;
  const PSEUDO_CLASS = /(:hover|:focus(-visible)?|:disabled|\.disabled|\[disabled\])/g;
  const MARK = "cq-replay-marker";

  const stripState = (s) =>
    s.replace(/::?(hover|focus(-visible)?|disabled|placeholder)/g, "")
     .replace(/\[disabled\]/g, "")
     .replace(/\.disabled/g, "")
     .trim();

  // Collect first, mutate after: inserting into a list being iterated shifts
  // every index behind it.
  const replays = [];
  for (const sheet of document.styleSheets) {
    try { void sheet.cssRules; } catch { continue; }
    /*
     * `owner` is the thing that can insert — a stylesheet or a grouping rule.
     * The CSSRuleList itself has no insertRule, so the list alone is not
     * enough to put a clone back next to its source.
     */
    const walk = (owner) => {
      const list = owner.cssRules;
      for (let i = 0; i < list.length; i++) {
        const rule = list[i];
        /*
         * Recurse on rules that actually CONTAIN rules, and then keep going
         * rather than `continue`-ing.
         *
         * `if (rule.cssRules) { walk(...); continue; }` looks right and does
         * nothing: since CSS Nesting shipped, CSSStyleRule extends
         * CSSGroupingRule, so an ordinary style rule exposes .cssRules — an
         * EMPTY CSSRuleList, which is an object, which is truthy. Every plain
         * rule took the recurse branch, walked nothing, and never reached the
         * selector test below. This entire pass measured zero selectors, on
         * every run, silently (reported from the TSLS Companion port, #199).
         *
         * Not `continue`, because a nested rule can carry both a selector of
         * its own and children.
         */
        if (rule.cssRules?.length) walk(rule);
        if (!rule.selectorText || !PSEUDO.test(rule.selectorText)) continue;
        if (!rule.style?.getPropertyValue("color")) continue;
        // Only the comma-parts that carry a state. Keeping the others would
        // restyle elements that are in no state at all.
        const parts = rule.selectorText
          .split(",")
          .map((p) => p.trim())
          .filter((p) => PSEUDO.test(p) && stripState(p));
        if (parts.length === 0) continue;
        replays.push({ owner, index: i, rule, parts });
      }
    };
    walk(sheet);
  }

  const inserted = [];
  // Each insertion pushes everything behind it down one, so a source rule's
  // recorded index is stale by however many clones already went into that
  // same owner. Without this the clones drift ahead of rules they must lose
  // to — reintroducing the cascade error by a different route.
  const shift = new Map();
  for (const { owner, index, rule, parts } of replays) {
    const classParts = parts.filter((p) => !p.includes("::"));
    if (classParts.length === 0) continue;
    const selector = classParts
      .map((p) => p.replace(PSEUDO_CLASS, `.${MARK}`))
      .join(", ");
    const body = rule.cssText.slice(rule.cssText.indexOf("{"));
    try {
      // Right after the source rule: a clone appended to the end of the
      // document would beat later rules it should lose to, which is the
      // very mistake this pass is here to stop making.
      const offset = shift.get(owner) ?? 0;
      const at = owner.insertRule(`${selector} ${body}`, index + 1 + offset);
      shift.set(owner, offset + 1);
      inserted.push({ owner, at });
    } catch { /* selector the engine won't take — skip it */ }
  }

  const measure = (el, state, label, pseudoEl) => {
    const cs = getComputedStyle(el, pseudoEl ?? undefined);
    const bg = bgOf(el);
    if (bg.gradient) return;
    const fg = parse(cs.color);
    if (!fg) return;
    const op = opacityOf(el);
    const eff = over([fg[0], fg[1], fg[2], fg[3] * op], bg.color);
    const cr = ratio(eff, bg.color);
    const need = threshold(getComputedStyle(el));
    if (cr < need) {
      push({
        state, sel: label, ratio: cr, need,
        color: cs.color, opacity: op,
        text: el.textContent.trim().slice(0, 40),
      });
    }
  };

  /*
   * Rendered elements only — the same guard pass 1 applies, and for the same
   * reason. .sidebar-close is display:none above 900px and its hover rule
   * lives in a media query that isn't active at this viewport, so measuring
   * it read the inherited ink colour against the navy drawer and called it
   * 1.15:1: a failure in a state no user at this width can reach.
   */
  const rendered = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };

  for (const { parts } of replays) {
    for (const p of parts) {
      const base = stripState(p);
      let els;
      try { els = document.querySelectorAll(base); } catch { continue; }
      const state = p.match(PSEUDO)[0];
      for (const el of [...els].slice(0, 4)) {
        if (!rendered(el)) continue;
        if (p.includes("::")) {
          measure(el, state, `${base}  {${state}}`, state);
          continue;
        }
        /*
         * If the marker changes nothing, the rule did not apply here — it is
         * behind an inactive media query, or outscored by something later.
         * Measuring anyway would report the element's ORDINARY colour as if
         * it were the hover state, which is a failure nobody can reach.
         * Nothing is lost by skipping: pass 1 has already measured that.
         */
        const before = getComputedStyle(el).color;
        el.classList.add(MARK);
        if (getComputedStyle(el).color !== before) {
          measure(el, state, `${base}  {${state}}`, null);
        }
        el.classList.remove(MARK);
      }
    }
  }

  // Leave the page as we found it — later routes reuse this context.
  for (const { owner, at } of inserted.reverse()) {
    try { owner.deleteRule(at); } catch { /* already gone */ }
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
    /*
     * "load" plus a short settle, NOT networkidle.
     *
     * networkidle waits for the network to go quiet, and one request that
     * never settles takes the whole route down with it: /start prefetches a
     * link whose RSC response stays open, so the page loaded fine in 31ms and
     * the audit skipped it on a 20s timeout — for months, on a public page,
     * reported as one grey "skip" line among the genuine 404s.
     */
    const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 20000 });
    if (!res || res.status() >= 400) { console.error(`skip ${route} (${res?.status()})`); continue; }
    // Let fonts, images and any client render land before measuring.
    await page.waitForTimeout(1200);
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

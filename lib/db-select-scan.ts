import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SPEAKER_FROM_LINEUP,
  SPEAKER_FROM_SESSION,
} from "./session-speaker-embed";

/*
 * Finds every PostgREST select in the source that EMBEDS a related table.
 *
 * Embeds are the fragile part of a select. A plain column list breaks loudly
 * and locally; an embed can stop resolving because of a change made somewhere
 * else entirely — migration 0087 added a junction table and silently made
 * `speakers ( ... )` ambiguous in six files, taking the app down for a day
 * (2026-08-12).
 *
 * Used by tests/db-selects.test.ts to prove lib/db-selects.ts covers every
 * embed the app actually performs. Node-only (reads the filesystem); never
 * import it from application code.
 */

export const SCAN_ROOTS = ["app", "lib", "components", "scripts"];

/*
 * A related table followed by a parenthesised column list: `profiles ( email )`,
 * `speakers!hint ( name )`, or `${SPEAKER_FROM_SESSION} ( name )`. A comma or
 * the string start must precede it, so a function call inside a template
 * literal does not read as an embed.
 *
 * The `${...}` alternative matters more than it looks: the embed hints live in
 * constants, so SESSION_SELECT — the very select that caused the 2026-08-12
 * outage — is spelled with an interpolation. An earlier version of this
 * pattern missed it, which would have left the scan looking thorough while
 * ignoring the one query that has already broken.
 */
const EMBED = /(^|,)\s*(?:\$\{[^}]*\}|[a-z_][a-z0-9_]*(?:!\w+)?)\s*\(/gi;

export function hasEmbed(select: string): boolean {
  EMBED.lastIndex = 0;
  return EMBED.test(select);
}

/**
 * The relations a select embeds, at the TOP level and nested, as written.
 * An interpolated name is reported as the constant's expression text — the
 * registry resolves it; here it only needs to be stable.
 */
export function embeddedRelations(select: string): string[] {
  const names = new Set<string>();
  // The opening paren is a LOOKAHEAD: consuming it would eat the delimiter
  // the next relation needs, so `sessions ( speakers ( name ) )` would report
  // only `sessions` — and a nested embed is exactly as ambiguity-prone as a
  // top-level one.
  for (const m of select.matchAll(
    /(?:^|[,(])\s*(\$\{[^}]*\}|[a-z_][a-z0-9_]*)(?:!\w+)?\s*(?=\()/gi,
  )) {
    names.add(m[1]);
  }
  return [...names].sort();
}

/** Collapse whitespace so a multi-line select compares equal to a one-liner. */
export function normalizeSelect(select: string): string {
  return select.replace(/\s+/g, " ").trim();
}

/*
 * Embed hints live in constants, so the source spells them as `${NAME}`.
 * PostgREST needs the resolved text, so substitute the ones we know before
 * a select is recorded or probed. Anything left interpolated is a column
 * list rather than a relation (SESSION_COLS, say) and is dropped from the
 * probe — see the generator, which refuses to emit an unresolved select.
 */
const CONSTANTS: Record<string, string> = {
  "${SPEAKER_FROM_SESSION}": SPEAKER_FROM_SESSION,
  "${SPEAKER_FROM_LINEUP}": SPEAKER_FROM_LINEUP,
};

export function resolveConstants(select: string): string {
  let out = select;
  for (const [token, value] of Object.entries(CONSTANTS)) {
    out = out.split(token).join(value);
  }
  return out;
}

/** True when a select still carries an interpolation we cannot resolve. */
export function isUnresolved(select: string): boolean {
  return select.includes("${");
}

export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

export interface FoundSelect {
  file: string;
  select: string;
  /** The `.from("…")` this select is chained to, when it can be read off the
      source. Null for shared constants, whose table lives at the call site. */
  table: string | null;
}

/** Nearest `.from("x")` before `index` — the chain this select belongs to. */
function tableFor(src: string, index: number): string | null {
  const before = src.slice(0, index);
  const matches = [...before.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

/*
 * Two shapes are collected:
 *   .select("...")            — the call site spells the select out
 *   const FOO_SELECT = "..."  — a shared constant, often reused with fallbacks
 * Both may be quoted, single-quoted, or a template literal, and may span
 * lines. Template literals containing ${...} are kept: the interpolation is
 * almost always a hint constant, and the registry stores the resolved string.
 */
const SELECT_CALL = /\.select\(\s*(["'`])([\s\S]*?)\1/g;
const SELECT_CONST = /\b[A-Z][A-Z0-9_]*SELECT[A-Z0-9_]*\s*=\s*(["'`])([\s\S]*?)\1/g;

export function findEmbeddedSelects(roots: string[] = SCAN_ROOTS): FoundSelect[] {
  const found: FoundSelect[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, "utf8");
      for (const re of [SELECT_CALL, SELECT_CONST]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          const select = normalizeSelect(m[2]);
          if (!select || !hasEmbed(select)) continue;
          found.push({
            file,
            select,
            table: re === SELECT_CALL ? tableFor(src, m.index) : null,
          });
        }
      }
    }
  }
  return found;
}

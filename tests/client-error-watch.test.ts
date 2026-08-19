import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Global crash reporting (2026-08-19).
 *
 * Before this, reportClientError was reachable from two files only — the
 * two React error boundaries — so Admin → Platform Errors recorded crashes
 * during RENDER and nothing else. Every button handler, server action and
 * async callback in the app failed silently. An empty error page read as
 * "no crashes" when it meant "we aren't listening".
 *
 * The behaviour is the browser's; what is worth pinning is the wiring and
 * the two bounds, because the failure mode of a global error handler is a
 * page that reports itself in a loop.
 */

const read = (p: string) => readFileSync(p, "utf8");

test("both global handlers are registered, and removed again", () => {
  const src = read("components/ClientErrorWatch.tsx");
  assert.match(src, /addEventListener\("error"/);
  assert.match(src, /addEventListener\("unhandledrejection"/);
  // Without the cleanup, every client navigation would stack another pair
  // of listeners and one throw would report N times.
  assert.match(src, /removeEventListener\("error"/);
  assert.match(src, /removeEventListener\("unhandledrejection"/);
});

test("it is mounted in the root layout, not a portal layout", () => {
  /*
   * The signed-out routes are where a crash costs the most — /join and
   * /login are the paths a member cannot work around. Mounting this under
   * (portal) would cover only people who already got in.
   */
  const layout = read("app/layout.tsx");
  assert.match(layout, /<ClientErrorWatch \/>/);
  assert.match(layout, /from "@\/components\/ClientErrorWatch"/);
});

test("a repeated error reports once, and distinct errors are capped", () => {
  const src = read("components/ClientErrorWatch.tsx");
  // Per-error dedup: a re-render loop throwing the same thing is one report.
  assert.match(src, /seen\.has\(key\)/);
  assert.match(src, /seen\.add\(key\)/);
  // Hard ceiling: a page failing in a NEW way each frame defeats dedup, so
  // the count is bounded too.
  assert.match(src, /sent >= MAX_PER_PAGE_LOAD/);
  const cap = Number(src.match(/MAX_PER_PAGE_LOAD = (\d+)/)?.[1]);
  assert.ok(cap > 0 && cap <= 10, `cap should be small, got ${cap}`);
});

test("noise that no one can act on is dropped", () => {
  /*
   * Cross-origin "Script error." carries no message, file, or line — the
   * row would say "something, somewhere". ResizeObserver loop notices fire
   * in bursts and are not faults. An aborted fetch is a member navigating
   * away. All three would bury the real reports.
   */
  const src = read("components/ClientErrorWatch.tsx");
  for (const noise of ["Script error.", "ResizeObserver loop", "AbortError"]) {
    assert.ok(src.includes(noise), `${noise} should be filtered`);
  }
});

test("reports say which half of the pipeline caught them", () => {
  // A render crash and a handler crash want different first questions, and
  // the message alone doesn't distinguish them on the admin page.
  const src = read("components/ClientErrorWatch.tsx");
  assert.match(src, /\[\$\{kind\}\] \$\{message\}/);
  assert.match(src, /"uncaught"/);
  assert.match(src, /"unhandled rejection"/);
});

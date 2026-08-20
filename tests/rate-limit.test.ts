import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CEILINGS } from "../lib/rate-limit";

/*
 * Inbound ceilings on the x-api-key surfaces (TSLS security review,
 * 2026-08-19, mitigation 2).
 *
 * These routes had no inbound limit of any kind. The key is the control;
 * this bounds what a leaked one can do before anyone notices.
 */

const SURFACES: [string, string][] = [
  ["app/api/webhooks/zapier/route.ts", "webhooks/zapier"],
  ["app/api/bridge/profile/route.ts", "bridge/profile"],
  ["app/api/bridge/tiers/route.ts", "bridge/tiers"],
  ["app/api/bridge/ping/route.ts", "bridge/ping"],
  ["app/api/bridge/reveal/route.ts", "bridge/reveal"],
  ["app/api/sso/handoff/route.ts", "sso/handoff"],
];

test("every key-guarded surface has a ceiling and applies it", () => {
  for (const [path, surface] of SURFACES) {
    assert.ok(CEILINGS[surface], `${surface} has no ceiling`);
    assert.match(
      readFileSync(path, "utf8"),
      new RegExp(`rateLimited\\("${surface}"\\)`),
      `${path} never calls its limiter`,
    );
  }
});

test("the ceiling is applied AFTER the key check, never before", () => {
  /*
   * Order matters both ways. Before the key check, an unauthenticated
   * flood would exhaust the budget the real caller needs — turning a
   * rate limiter into a denial-of-service tool against ourselves.
   */
  for (const [path] of SURFACES) {
    const src = readFileSync(path, "utf8");
    const auth = Math.min(
      ...[/bridgeAuthorized\(/, /revealAuthorized\(/, /authorized\(req\)/]
        .map((re) => src.search(re))
        .filter((i) => i >= 0),
    );
    const limit = src.indexOf("rateLimited(");
    assert.ok(auth >= 0, `${path}: no auth check found`);
    assert.ok(limit > auth, `${path}: rate limit runs before the key check`);
  }
});

test("the reveal's ceiling sits below BOTH doors", () => {
  // A dry run takes either key. If the limiter only guarded the real path,
  // dry runs could exhaust nothing — but if it only guarded the dry path,
  // the activation would be unbounded. It must be past the whole branch.
  const src = readFileSync("app/api/bridge/reveal/route.ts", "utf8");
  const branchEnd = src.indexOf("isSupabaseConfigured", src.indexOf("} else {"));
  assert.ok(src.indexOf("rateLimited(") > branchEnd, "limiter is inside a branch");
});

test("the reveal's ceiling is the tightest, and still allows retries", () => {
  /*
   * It is pressed once, ever. But a real reveal legitimately retries —
   * draining `remaining`, or pressing again when unsure the first press
   * landed — so the ceiling must be low without being in the way.
   */
  const reveal = CEILINGS["bridge/reveal"];
  assert.ok(reveal.perMinute >= 5, "too tight — a genuine retry would 429");
  assert.ok(reveal.perMinute <= 15, "too loose for a once-ever action");
  for (const [surface, c] of Object.entries(CEILINGS)) {
    if (surface === "bridge/reveal") continue;
    assert.ok(
      c.perMinute > reveal.perMinute,
      `${surface} is tighter than the reveal, which should be the tightest`,
    );
  }
});

test("provisioning has room for a real backlog drain", () => {
  // TSLS pushed 79 guests in one run during the August re-push, and a
  // sold-out summit is several hundred. A ceiling that blocks the drain
  // would be discovered on the worst possible day.
  assert.ok(CEILINGS["webhooks/zapier"].perMinute >= 100);
  assert.ok(CEILINGS["webhooks/zapier"].perHour >= 1000);
});

test("both windows are enforced, not just one", () => {
  /*
   * Either alone leaves the other open: 100/min passes an hourly cap for
   * ten minutes, and 500/hr permits a 500-request second.
   */
  const src = readFileSync("lib/rate-limit.ts", "utf8");
  assert.match(src, /bump\(surface, 60, ceiling\.perMinute\)/);
  assert.match(src, /bump\(surface, 3600, ceiling\.perHour\)/);
  for (const [surface, c] of Object.entries(CEILINGS)) {
    assert.ok(c.perHour > c.perMinute, `${surface}: hourly must exceed per-minute`);
  }
});

test("it fails OPEN, loudly", () => {
  /*
   * A safety net behind a secret, not the control itself. A limiter outage
   * silently blocking TSLS's guest sync on event day is worse than briefly
   * having no ceiling — fail-closed would put a database hiccup between a
   * paying attendee and their account. But a ceiling that has quietly
   * stopped working must not look like one that is.
   */
  const src = readFileSync("lib/rate-limit.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function rateLimited"));
  assert.match(fn, /counter unavailable, allowing/);
  assert.match(fn, /catch \(e\)/);
  assert.match(fn, /console\.warn/);
  // Every early return on the failure paths is null (allow), never a 429.
  assert.doesNotMatch(
    fn.slice(fn.indexOf("catch (e)")),
    /status: 429/,
    "an error must not be treated as over-limit",
  );
});

test("the counter is atomic and service-role only", () => {
  /*
   * Read-then-write would let two concurrent requests both see 9 and both
   * write 10, so the ceiling would leak under exactly the load it exists
   * for. The upsert takes a row lock instead.
   */
  const sql = readFileSync("supabase/migrations/0096_api_rate_limits.sql", "utf8");
  assert.match(sql, /on conflict \(bucket\)\s*\n\s*do update set count = public\.api_rate_counters\.count \+ 1/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke execute on function public\.api_rate_bump/);
  assert.match(sql, /grant execute on function public\.api_rate_bump\(text, timestamptz\) to service_role/);
});

test("the window start is part of the key, so no reset can be raced", () => {
  const src = readFileSync("lib/rate-limit.ts", "utf8");
  assert.match(src, /\$\{surface\}:\$\{windowSeconds\}:\$\{startMs\}/);
  // Old rows are pruned, or the table grows forever.
  const sql = readFileSync("supabase/migrations/0096_api_rate_limits.sql", "utf8");
  assert.match(sql, /delete from public\.api_rate_counters/);
});

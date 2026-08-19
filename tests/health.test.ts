import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageLabel,
  CRON_EXPECTATIONS,
  cronCheck,
  diffReports,
  lateCrons,
  type HealthReport,
} from "../lib/health-shared";

/*
 * The health check's two decisions that must never be wrong: WHEN a quiet
 * cron counts as late, and WHICH state changes trigger an alert email.
 */

const NOW = Date.parse("2026-07-31T12:00:00Z");
const minutesAgo = (m: number) => ({
  at: new Date(NOW - m * 60_000).toISOString(),
});

test("a cron inside 2x its interval is on schedule", () => {
  const { late, neverRan } = lateCrons(
    { reminders: 5 },
    { reminders: minutesAgo(80) },
    NOW,
  );
  // 5-min job, quiet for 80 min — still inside the 90-minute floor.
  assert.equal(late.length, 0);
  assert.equal(neverRan.length, 0);
});

test("the 90-minute floor keeps fast jobs from paging over one quiet hour", () => {
  const { late } = lateCrons({ reminders: 5 }, { reminders: minutesAgo(89) }, NOW);
  assert.equal(late.length, 0);
  const after = lateCrons({ reminders: 5 }, { reminders: minutesAgo(95) }, NOW);
  assert.deepEqual(after.late.map((l) => l.name), ["reminders"]);
});

test("an hourly job pages only after 2x its interval, not at the floor", () => {
  const { late } = lateCrons({ summaries: 60 }, { summaries: minutesAgo(110) }, NOW);
  assert.equal(late.length, 0);
  const after = lateCrons({ summaries: 60 }, { summaries: minutesAgo(130) }, NOW);
  assert.deepEqual(after.late.map((l) => l.name), ["summaries"]);
});

test("a daily cron is late after 2 days, not after 90 minutes", () => {
  const ok = lateCrons({ reconcile: 1440 }, { reconcile: minutesAgo(1500) }, NOW);
  assert.equal(ok.late.length, 0);
  const bad = lateCrons({ reconcile: 1440 }, { reconcile: minutesAgo(3000) }, NOW);
  assert.equal(bad.late.length, 1);
});

test("never-run crons are reported separately, not as failures", () => {
  const result = lateCrons({ "tsls-import": 30 }, {}, NOW);
  assert.deepEqual(result.neverRan, ["tsls-import"]);
  assert.equal(result.late.length, 0);
  const check = cronCheck(result, 1);
  // Seasonal/unconfigured crons must not fail the whole health check…
  assert.equal(check.ok, true);
  // …but the panel still says so.
  assert.match(check.note, /tsls-import/);
});

test("an unparseable timestamp counts as late, not silently fine", () => {
  const { late } = lateCrons({ reminders: 5 }, { reminders: { at: "garbage" } }, NOW);
  assert.equal(late.length, 1);
});

test("cronCheck summarizes late jobs into one failing check", () => {
  const check = cronCheck(
    lateCrons(
      { reminders: 5, summaries: 60 },
      { reminders: minutesAgo(200), summaries: minutesAgo(10) },
      NOW,
    ),
    2,
  );
  assert.equal(check.ok, false);
  assert.match(check.note, /reminders/);
  assert.doesNotMatch(check.note, /summaries/);
});

test("ageLabel picks sensible units", () => {
  assert.equal(ageLabel(45 * 60_000), "45 min");
  assert.equal(ageLabel(5 * 3600_000), "5h");
  assert.equal(ageLabel(72 * 3600_000), "3d");
});

// ---------------------------------------------------------------------------
// Transition-based alerting
// ---------------------------------------------------------------------------

const report = (
  checks: { name: string; ok: boolean; skipped?: boolean }[],
): HealthReport => ({
  at: new Date(NOW).toISOString(),
  checks: checks.map((c) => ({ note: "", ...c })),
});

test("first-ever failure alerts even with no previous report", () => {
  const { failures } = diffReports(null, report([{ name: "Stripe", ok: false }]));
  assert.deepEqual(failures.map((f) => f.name), ["Stripe"]);
});

test("a service that stays down does NOT re-alert", () => {
  const prev = report([{ name: "Stripe", ok: false }]);
  const { failures, recoveries } = diffReports(
    prev,
    report([{ name: "Stripe", ok: false }]),
  );
  assert.equal(failures.length, 0);
  assert.equal(recoveries.length, 0);
});

test("recovery is reported exactly once", () => {
  const prev = report([{ name: "Stripe", ok: false }]);
  const { recoveries } = diffReports(prev, report([{ name: "Stripe", ok: true }]));
  assert.deepEqual(recoveries.map((r) => r.name), ["Stripe"]);
  // …and staying healthy afterwards is silent.
  const again = diffReports(
    report([{ name: "Stripe", ok: true }]),
    report([{ name: "Stripe", ok: true }]),
  );
  assert.equal(again.recoveries.length, 0);
});

test("skipped (unconfigured) checks never alert in either direction", () => {
  const prev = report([{ name: "Zoom", ok: false }]);
  const { failures, recoveries } = diffReports(
    prev,
    report([{ name: "Zoom", ok: false, skipped: true }]),
  );
  assert.equal(failures.length, 0);
  assert.equal(recoveries.length, 0);
  // Un-skipping straight into a failure IS a new failure.
  const unskipped = diffReports(
    report([{ name: "Zoom", ok: true, skipped: true }]),
    report([{ name: "Zoom", ok: false }]),
  );
  assert.deepEqual(unskipped.failures.map((f) => f.name), ["Zoom"]);
});

/*
 * The expectations table against the actual schedule.
 *
 * It drifted the first time it could: the badges cron shipped in vercel.json
 * with no entry here, so Connections would have said "all jobs on schedule"
 * for a job that had never run. The list is the only thing that notices a
 * silently dead cron, so nothing may be in one file and not the other.
 */
test("every scheduled cron has a health expectation, and vice versa", async () => {
  const { readFileSync } = await import("node:fs");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: { path: string; schedule: string }[];
  };

  // /api/cron/<name> reports as <name>; the TSLS import is the one job that
  // lives outside that prefix and stamps its own heartbeat name.
  const SPECIAL: Record<string, string> = { "/api/import/tsls": "tsls-import" };
  const scheduled = vercel.crons.map(
    (c) => SPECIAL[c.path] ?? c.path.replace("/api/cron/", ""),
  );

  for (const name of scheduled) {
    assert.ok(
      name in CRON_EXPECTATIONS,
      `${name} is scheduled in vercel.json but has no health expectation — it could die unnoticed`,
    );
  }
  for (const name of Object.keys(CRON_EXPECTATIONS)) {
    assert.ok(
      scheduled.includes(name),
      `${name} is expected by the health check but is not scheduled — it would page forever`,
    );
  }
});

/*
 * The RPC probe against the RPCs the app actually calls.
 *
 * Same failure mode as the cron table above, with a worse symptom. All three
 * SECURITY DEFINER functions are on the sign-in and account-recovery path,
 * and every caller degrades rather than fails — auth_activity and
 * auth_user_id_by_email fall back to paging listUsers, and auth_has_password
 * fails closed to "they have one", which silently restores the double
 * password prompt Rob hit in August. A revoked grant or a rolled-back
 * migration would show no symptom at all until a member reported one.
 *
 * So a fourth RPC added without a probe must fail here, not in production.
 */
test("every RPC the app calls is probed by the health check", async () => {
  const { readFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");

  const called = new Set(
    execFileSync(
      "grep",
      ["-rho", "--include=*.ts", "--include=*.tsx", '\\.rpc(\\s*"[a-z_]*"', "app", "lib"],
      { encoding: "utf8" },
    )
      .split("\n")
      .map((l) => l.match(/"([a-z_]+)"/)?.[1])
      .filter((n): n is string => Boolean(n)),
  );

  const health = readFileSync("lib/health.ts", "utf8");
  const probeBlock = health.slice(health.indexOf('guard("Database functions"'));
  assert.ok(probeBlock.length > 0, "the Database functions check is gone");

  for (const fn of called) {
    assert.ok(
      probeBlock.includes(`"${fn}"`),
      `${fn}() is called by the app but not probed on Admin → Connections — ` +
        `if it breaks, its callers degrade quietly and nobody finds out`,
    );
  }
  assert.ok(called.size >= 3, `expected at least 3 RPCs, found ${called.size}`);
});

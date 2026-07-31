import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ageLabel,
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

test("the 90-minute floor keeps hourly jobs from paging at minute 61", () => {
  const { late } = lateCrons({ summaries: 60 }, { summaries: minutesAgo(89) }, NOW);
  assert.equal(late.length, 0);
  const after = lateCrons({ summaries: 60 }, { summaries: minutesAgo(95) }, NOW);
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

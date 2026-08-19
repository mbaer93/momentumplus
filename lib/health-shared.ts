/*
 * Pure logic for the recurring health checks — no server imports, so the
 * staleness math and alert-transition rules are unit-testable. The actual
 * integration probes live in lib/health.ts.
 */

export interface HealthCheck {
  name: string;
  /** Probe passed. Meaningless when skipped is true. */
  ok: boolean;
  /** Service isn't configured — rendered neutrally and never alerted on. */
  skipped?: boolean;
  note: string;
}

export interface HealthReport {
  at: string;
  checks: HealthCheck[];
}

/** Cron name → scheduled interval in minutes (mirrors vercel.json). */
export type CronExpectations = Record<string, number>;

/**
 * Scheduled interval per cron, in minutes — keep in step with vercel.json.
 *
 * Lives here, beside lateCrons, so a test can hold it against vercel.json.
 * It drifted once already: the badges job (0091–0094) shipped without an
 * entry, which meant Connections would have reported "all jobs on schedule"
 * however long it stayed dead. A cron nobody is watching is a cron that has
 * already failed.
 */
export const CRON_EXPECTATIONS: CronExpectations = {
  attendance: 30,
  "tsls-import": 30,
  reconcile: 1440,
  dunning: 1440,
  reminders: 5,
  summaries: 60,
  "scheduled-posts": 5,
  "monthly-report": 44640,
  "gift-activate": 1440,
  health: 360,
  podcast: 360,
  badges: 1440,
};


export function ageLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Which scheduled jobs have gone quiet. A cron is LATE once it's been
 * silent for 2× its interval (never less than 90 minutes — schedules
 * drift, and an hourly job shouldn't page at minute 61). Jobs that have
 * never recorded a run are reported separately, not as failures: several
 * crons only stamp a heartbeat after their integration is configured or
 * in season, and "never run" would otherwise false-alarm forever.
 */
export function lateCrons(
  expectations: CronExpectations,
  lastRuns: Record<string, { at: string }>,
  nowMs: number,
): { late: { name: string; overdue: string }[]; neverRan: string[] } {
  const late: { name: string; overdue: string }[] = [];
  const neverRan: string[] = [];
  for (const [name, everyMinutes] of Object.entries(expectations)) {
    const run = lastRuns[name];
    if (!run) {
      neverRan.push(name);
      continue;
    }
    const ageMs = nowMs - new Date(run.at).getTime();
    const thresholdMs = Math.max(2 * everyMinutes, 90) * 60_000;
    // NaN-safe: an unparseable timestamp counts as late, not silently fine.
    if (!(ageMs < thresholdMs)) {
      late.push({ name, overdue: ageLabel(ageMs) });
    }
  }
  return { late, neverRan };
}

/** Summarize a lateCrons result as one HealthCheck. */
export function cronCheck(
  result: ReturnType<typeof lateCrons>,
  totalJobs: number,
): HealthCheck {
  const parts: string[] = [];
  if (result.late.length > 0) {
    parts.push(
      `late: ${result.late.map((l) => `${l.name} (last ran ${l.overdue} ago)`).join(", ")}`,
    );
  }
  if (result.neverRan.length > 0) {
    parts.push(`no run recorded yet: ${result.neverRan.join(", ")}`);
  }
  return {
    name: "Scheduled jobs",
    ok: result.late.length === 0,
    note:
      parts.length > 0
        ? parts.join(" — ")
        : `all ${totalJobs} jobs on schedule`,
  };
}

/**
 * Transition-based alerting: compare the new report against the previous
 * one and surface only what CHANGED. A service that stays down alerts
 * once at the moment it breaks and once when it recovers — never a
 * 6-hourly drumbeat in between. Skipped (unconfigured) checks never
 * participate. A check failing on its very first appearance counts as a
 * new failure.
 */
export function diffReports(
  previous: HealthReport | null,
  current: HealthReport,
): { failures: HealthCheck[]; recoveries: HealthCheck[] } {
  const prev = new Map((previous?.checks ?? []).map((c) => [c.name, c]));
  const failures: HealthCheck[] = [];
  const recoveries: HealthCheck[] = [];
  for (const check of current.checks) {
    if (check.skipped) continue;
    const before = prev.get(check.name);
    if (!check.ok) {
      if (!before || before.skipped || before.ok) failures.push(check);
    } else if (before && !before.skipped && !before.ok) {
      recoveries.push(check);
    }
  }
  return { failures, recoveries };
}

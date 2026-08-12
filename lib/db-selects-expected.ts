/*
 * Selects that are EXPECTED to fail, because the schema they read is
 * deliberately absent.
 *
 * The page-data health check probes every select in the app. That is the
 * point — the queries that break are the ones nobody watches. But a check
 * that is permanently red is a check people stop reading, and then it may as
 * well not exist. So a deliberate absence is recorded here, with a reason and
 * a condition for deleting the entry.
 *
 * The bar for adding one is high: the schema must be missing ON PURPOSE and
 * the code must already degrade without it. "We have not run that migration
 * yet" is not an entry here — that is a red check doing its job.
 *
 * Nothing is swallowed. Skipped selects are counted and named in the check's
 * note on Admin → Connections, every run, so an entry cannot quietly rot.
 */

export interface ExpectedFailure {
  /** Table the select reads. */
  table: string;
  /** Substring identifying the select; "" matches every select on the table. */
  contains: string;
  /** Why it is absent, and what would make this entry wrong. */
  reason: string;
}

export const EXPECTED_FAILURES: ExpectedFailure[] = [
  {
    table: "referrals",
    contains: "",
    reason:
      "referrals table intentionally not created — 0035's referral half was " +
      "never applied and 0088 deliberately left it that way; the reward was " +
      "never agreed (Matt: no real money paid out for referrals) and the " +
      "payout code is deleted. Delete this entry if the table is ever created.",
  },
  {
    table: "profiles",
    contains: "referral_code",
    reason:
      "profiles.referral_code comes from the same unapplied half of 0035. " +
      "lib/referrals.ts returns early when it is missing, so attribution is " +
      "inert rather than broken. Delete this entry with the one above.",
  },
];

/** The reason this select is expected to fail, or null if it is not. */
export function expectedFailure(
  table: string,
  select: string,
): ExpectedFailure | null {
  return (
    EXPECTED_FAILURES.find(
      (e) => e.table === table && (e.contains === "" || select.includes(e.contains)),
    ) ?? null
  );
}

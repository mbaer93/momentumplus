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

/*
 * Empty, and that is the healthy state.
 *
 * The two entries this list was created for — the referrals table and
 * profiles.referral_code — are gone because the referral feature itself was
 * deleted rather than exempted. It had never worked in production: 0035's
 * referral half was never applied, so no member ever saw a referral link or a
 * count. An exemption would have made a permanently-dead feature look like a
 * deliberate, maintained absence.
 *
 * So this is the second-best outcome the mechanism can produce, after "no
 * exemption was ever needed": the exemption existed exactly as long as the
 * thing it described, and left with it. Keep it that way.
 */
export const EXPECTED_FAILURES: ExpectedFailure[] = [];

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

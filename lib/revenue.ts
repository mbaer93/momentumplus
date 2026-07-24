import { getStripeSettings, stripeRequest } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/db-utils";

/*
 * Speaker-of-the-month math (Matt, 2026-07-24).
 *
 * Revenue basis is MONTHLY-EQUIVALENT (Matt's pick over cash-collected):
 * every paid Stripe invoice is spread evenly across the calendar months its
 * billing period covers, so a $1,668 12-month plan contributes $139 to each
 * of its 12 months no matter when it was bought. A speaker's month earns
 * 15% of that month's total. All membership money runs through Stripe
 * (confirmed by Matt), so Stripe's paid-invoice history IS the ledger —
 * nothing to capture locally, no backfill problem.
 *
 * Results are cached in app_settings (service-role only) because computing
 * a month means paging Stripe invoices ~13 months back. Months still in
 * progress refresh after a short TTL; finished months practically never
 * change (late refunds are rare) but refresh daily anyway.
 */

export const SPEAKER_REVENUE_SHARE = 0.15;

const CACHE_KEY = "revenue_months";
const OPEN_MONTH_TTL_MS = 6 * 60 * 60 * 1000; // in-progress month: 6h
const CLOSED_MONTH_TTL_MS = 24 * 60 * 60 * 1000; // finished month: daily
const MAX_INVOICE_PAGES = 30; // 100/page — far above realistic volume

// ---------------------------------------------------------------------------
// Month keys (ET) — "YYYY-MM"
// ---------------------------------------------------------------------------

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
});

export function monthKeyOf(date: Date): string {
  const parts = ET_PARTS.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** ET month window as UTC instants — approximated with fixed -05:00 for the
    start-of-month boundary. A member paying within minutes of an ET month
    boundary lands in one month or the other; nothing else is affected. */
export function monthWindow(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 5)); // 00:00 ET ≈ 05:00 UTC
  const end = new Date(Date.UTC(y, m, 1, 5));
  return { start, end };
}

// ---------------------------------------------------------------------------
// Stripe paid invoices → monthly-equivalent allocation
// ---------------------------------------------------------------------------

interface StripeInvoice {
  id: string;
  amount_paid: number; // cents
  created: number; // unix seconds
  lines?: {
    data?: { period?: { start?: number; end?: number } }[];
  };
}

interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

/** Months a billing period spans, by calendar arithmetic (1 for monthly,
    3/6/12 for term plans). Days-based rounding would misfire on Feb. */
function periodMonths(startSec: number, endSec: number): number {
  const s = new Date(startSec * 1000);
  const e = new Date(endSec * 1000);
  const months =
    (e.getUTCFullYear() - s.getUTCFullYear()) * 12 +
    (e.getUTCMonth() - s.getUTCMonth()) +
    (e.getUTCDate() >= s.getUTCDate() ? 0 : -1);
  return Math.max(1, months);
}

/**
 * Allocation for ONE invoice: each covered period-month contributes
 * amount/months to the calendar month its anchor date falls in (ET). A
 * monthly sub paid Jan 15 → all to January; an annual bought Jul 24 →
 * twelve $139 slices landing in Jul, Aug, … Jun.
 */
function allocate(
  inv: StripeInvoice,
  add: (monthKey: string, cents: number) => void,
): void {
  if (!inv.amount_paid || inv.amount_paid <= 0) return;
  const period = inv.lines?.data?.[0]?.period;
  const start = period?.start ?? inv.created;
  const end = period?.end ?? start;
  const months = periodMonths(start, end);
  const slice = inv.amount_paid / months;
  const anchor = new Date(start * 1000);
  for (let k = 0; k < months; k++) {
    const d = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + k, 15),
    );
    add(monthKeyOf(d), slice);
  }
}

/**
 * Monthly-equivalent revenue (cents) for one ET calendar month, from
 * Stripe's paid-invoice history. Null when Stripe isn't connected.
 */
async function computeMonthRevenueCents(
  monthKey: string,
): Promise<number | null> {
  const settings = await getStripeSettings();
  if (!settings?.secretKey) return null;

  // Any invoice whose period can reach this month was created at most 12
  // months before the month ends (longest term is 12 months).
  const { end } = monthWindow(monthKey);
  const createdGte =
    Math.floor(end.getTime() / 1000) - 370 * 24 * 60 * 60 - 5 * 24 * 60 * 60;

  const totals = new Map<string, number>();
  const add = (key: string, cents: number) =>
    totals.set(key, (totals.get(key) ?? 0) + cents);

  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_INVOICE_PAGES; page++) {
    const res = await stripeRequest<StripeList<StripeInvoice>>(
      settings.secretKey,
      "GET",
      "/invoices",
      {
        status: "paid",
        limit: 100,
        "created[gte]": createdGte,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    );
    for (const inv of res.data) allocate(inv, add);
    if (!res.has_more || res.data.length === 0) break;
    startingAfter = res.data[res.data.length - 1].id;
  }

  return Math.round(totals.get(monthKey) ?? 0);
}

// ---------------------------------------------------------------------------
// Cache (app_settings, service-role only)
// ---------------------------------------------------------------------------

interface CacheShape {
  [monthKey: string]: { cents: number; at: string };
}

export async function monthlyEquivalentRevenueCents(
  monthKey: string,
): Promise<number | null> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", CACHE_KEY)
    .maybeSingle();
  const cache = ((data?.value as CacheShape | undefined) ?? {}) as CacheShape;

  const cached = cache[monthKey];
  const monthOver = monthWindow(monthKey).end.getTime() <= Date.now();
  const ttl = monthOver ? CLOSED_MONTH_TTL_MS : OPEN_MONTH_TTL_MS;
  if (cached && Date.now() - new Date(cached.at).getTime() < ttl) {
    return cached.cents;
  }

  let cents: number | null = null;
  try {
    cents = await computeMonthRevenueCents(monthKey);
  } catch {
    // Stripe hiccup: serve stale if we have it rather than blanking the card.
    return cached?.cents ?? null;
  }
  if (cents === null) return cached?.cents ?? null;

  cache[monthKey] = { cents, at: new Date().toISOString() };
  await admin.from("app_settings").upsert(
    { key: CACHE_KEY, value: cache, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  return cents;
}

// ---------------------------------------------------------------------------
// Eligible members for a month
// ---------------------------------------------------------------------------

/** Tiers/sources that are NOT counted as "users on the platform" for the
    speaker card (Matt: exclude admins, speakers, sponsors, super admins). */
const EXCLUDED_TIERS = new Set(["admin", "speaker", "sponsor"]);
const EXCLUDED_SOURCES = new Set(["speaker", "sponsor"]);

/**
 * Distinct members whose active access overlaps the month, excluding staff
 * roles and comped speaker/sponsor seats. For months that haven't finished,
 * this is "members so far" — the number can still grow.
 */
export async function eligibleMemberCount(monthKey: string): Promise<number> {
  const { start, end } = monthWindow(monthKey);
  const admin = createServiceClient();
  const { rows } = await allRows<{
    profile_id: string;
    tier: string;
    source: string | null;
  }>((from, to) =>
    admin
      .from("memberships")
      .select("profile_id, tier, source")
      .eq("status", "active")
      .lt("access_starts_at", end.toISOString())
      .or(`access_expires_at.is.null,access_expires_at.gt.${start.toISOString()}`)
      .order("profile_id")
      .range(from, to),
  );
  const members = new Set<string>();
  for (const r of rows) {
    if (EXCLUDED_TIERS.has(r.tier)) continue;
    if (r.source && EXCLUDED_SOURCES.has(r.source)) continue;
    members.add(r.profile_id);
  }
  return members.size;
}

// ---------------------------------------------------------------------------
// The speaker card, in one call
// ---------------------------------------------------------------------------

export interface SpeakerMonthStats {
  monthKey: string;
  monthLabel: string;
  memberCount: number;
  /** Total monthly-equivalent revenue for the month; null = Stripe not
      connected (the card says so instead of showing $0). */
  revenueCents: number | null;
  /** 15% share — null when unpaid (TSLS Main Speaker) or revenue unknown. */
  earningsCents: number | null;
  /** True while the month hasn't ended (numbers still moving). */
  inProgress: boolean;
}

export async function speakerMonthStats(
  speakerMonth: string,
  opts: { paid: boolean },
): Promise<SpeakerMonthStats> {
  const [memberCount, revenueCents] = await Promise.all([
    eligibleMemberCount(speakerMonth),
    monthlyEquivalentRevenueCents(speakerMonth),
  ]);
  return {
    monthKey: speakerMonth,
    monthLabel: monthLabel(speakerMonth),
    memberCount,
    revenueCents,
    earningsCents:
      opts.paid && revenueCents !== null
        ? Math.round(revenueCents * SPEAKER_REVENUE_SHARE)
        : null,
    inProgress: monthWindow(speakerMonth).end.getTime() > Date.now(),
  };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

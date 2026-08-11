import { getStripeSettings, stripeRequest } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/db-utils";
import { sponsorActive } from "@/lib/sponsor-lifecycle";

/*
 * Speaker-of-the-month math (Matt, 2026-07-24).
 *
 * Revenue basis is MONTHLY-EQUIVALENT (Matt's pick over cash-collected):
 * every paid Stripe invoice is spread evenly across the calendar months its
 * billing period covers, so a $1,668 12-month plan contributes $139 to each
 * of its 12 months no matter when it was bought. A speaker's month earns
 * 15% of that month's total.
 *
 * The Stripe account is Sierra Learnership Collaborative's SHARED account
 * (Matt, 2026-08-03): Go High Level subscriptions, Aspire2Achieve
 * memberships, coaching, and TSLS sponsor payments all invoice through it.
 * Only invoices provably created by Momentum+ count — identified by our
 * subscription metadata (plan/profile_id), the momentum_plan metadata
 * stamped on every price the pricing wizard creates, or the price ids in
 * settings. Refunded amounts are subtracted, so fully refunded test
 * purchases contribute nothing.
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

interface StripeInvoiceLine {
  period?: { start?: number; end?: number };
  /** Classic shape: expanded price object with the wizard's metadata. */
  price?: { id?: string; metadata?: Record<string, string> } | null;
  /** Newer API shape: price id lives under pricing.price_details. */
  pricing?: { price_details?: { price?: string } };
}

interface StripeInvoice {
  id: string;
  amount_paid: number; // cents
  created: number; // unix seconds
  metadata?: Record<string, string>;
  subscription_details?: { metadata?: Record<string, string> };
  /** Newer API shape: subscription metadata moved under parent. */
  parent?: { subscription_details?: { metadata?: Record<string, string> } };
  /** Expanded charge — carries the refunded total. */
  charge?: { amount_refunded?: number } | string | null;
  lines?: {
    data?: StripeInvoiceLine[];
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

/** Every price id the pricing wizard currently has on file. */
function momentumPriceIds(settings: {
  prices: { basic?: string; pro?: string };
  termPrices?: { basic?: Record<string, string>; pro?: Record<string, string> };
}): Set<string> {
  const ids = new Set<string>();
  for (const id of Object.values(settings.prices)) if (id) ids.add(id);
  for (const plan of Object.values(settings.termPrices ?? {})) {
    for (const id of Object.values(plan ?? {})) if (id) ids.add(id);
  }
  return ids;
}

/**
 * Does this invoice belong to Momentum+? The shared account also bills
 * GHL/A2A subscriptions, coaching, and TSLS sponsorships — an invoice
 * counts only when it carries one of OUR fingerprints: the subscription
 * metadata set at checkout (plan basic/pro + profile_id), the
 * momentum_plan metadata the wizard stamps on every price it creates
 * (survives price recreation, unlike the ids in settings), or a price id
 * currently in settings.
 */
function isMomentumInvoice(inv: StripeInvoice, ownPriceIds: Set<string>): boolean {
  const subMeta =
    inv.subscription_details?.metadata ??
    inv.parent?.subscription_details?.metadata ??
    {};
  // Every Momentum+ subscription carries plan (basic/pro) in its metadata —
  // set by both the public /join flow and the in-app billing flow. A bare
  // profile_id is NOT used as a signal: it's a generic key other product
  // lines on the shared account could also set, and would inflate revenue
  // (and the 15% speaker payout derived from it).
  if (subMeta.plan === "basic" || subMeta.plan === "pro") return true;
  if (inv.metadata?.momentum_plan) return true;
  for (const line of inv.lines?.data ?? []) {
    if (line.price?.metadata?.momentum_plan) return true;
    const priceId = line.price?.id ?? line.pricing?.price_details?.price;
    if (priceId && ownPriceIds.has(priceId)) return true;
  }
  return false;
}

/**
 * Allocation for ONE invoice: each covered period-month contributes
 * amount/months to the calendar month its anchor date falls in (ET). A
 * monthly sub paid Jan 15 → all to January; an annual bought Jul 24 →
 * twelve $139 slices landing in Jul, Aug, … Jun. Refunds come off the
 * top — a refunded test purchase is not revenue.
 */
function allocate(
  inv: StripeInvoice,
  add: (monthKey: string, cents: number) => void,
): void {
  const refunded =
    typeof inv.charge === "object" && inv.charge
      ? (inv.charge.amount_refunded ?? 0)
      : 0;
  const net = (inv.amount_paid ?? 0) - refunded;
  if (net <= 0) return;
  const period = inv.lines?.data?.[0]?.period;
  const start = period?.start ?? inv.created;
  const end = period?.end ?? start;
  const months = periodMonths(start, end);
  const slice = net / months;
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

  const ownPriceIds = momentumPriceIds(settings);
  const totals = new Map<string, number>();
  const add = (key: string, cents: number) =>
    totals.set(key, (totals.get(key) ?? 0) + cents);

  let startingAfter: string | undefined;
  let complete = false;
  for (let page = 0; page < MAX_INVOICE_PAGES; page++) {
    const res = await stripeRequest<StripeList<StripeInvoice>>(
      settings.secretKey,
      "GET",
      "/invoices",
      {
        status: "paid",
        limit: 100,
        "created[gte]": createdGte,
        // Refund totals + price metadata for the ownership check.
        "expand[0]": "data.charge",
        "expand[1]": "data.lines.data.price",
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    );
    for (const inv of res.data) {
      if (isMomentumInvoice(inv, ownPriceIds)) allocate(inv, add);
    }
    if (!res.has_more || res.data.length === 0) {
      complete = true;
      break;
    }
    startingAfter = res.data[res.data.length - 1].id;
  }

  if (!complete) {
    // Hit the page cap with invoices still unread. Caching this partial sum
    // would silently understate speaker pay forever (oldest invoices, whose
    // term slices reach the queried month, drop off newest-first). Throw so
    // the caller serves the last good cached value instead of freezing a
    // wrong number.
    throw new Error(
      `revenue: invoice pagination exceeded ${MAX_INVOICE_PAGES} pages for ${monthKey}`,
    );
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

/* Which tiers count as "users on the platform" for the speaker card is now a
   switch per tier (member_tiers.counts_toward_speaker_pay, migration 0054):
   admins, speakers and sponsors were always excluded, and Momentum+ Lite
   joins them because it isn't a full share of a month (Matt, 2026-07-28).
   The set below is only the pre-migration fallback. */
const FALLBACK_EXCLUDED_TIERS = new Set(["admin", "speaker", "sponsor", "lite"]);
const EXCLUDED_SOURCES = new Set(["speaker", "sponsor"]);

/** Tier slugs that do NOT count, read from the registry. */
async function nonCountingTiers(): Promise<Set<string>> {
  try {
    const { data, error } = await createServiceClient()
      .from("member_tiers")
      .select("slug, counts_toward_speaker_pay");
    if (error || !data?.length) return FALLBACK_EXCLUDED_TIERS;
    return new Set(
      data
        .filter((r) => r.counts_toward_speaker_pay === false)
        .map((r) => String(r.slug)),
    );
  } catch {
    return FALLBACK_EXCLUDED_TIERS;
  }
}

/**
 * Distinct members whose active access overlaps the month, excluding staff
 * roles and comped speaker/sponsor seats. For months that haven't finished,
 * this is "members so far" — the number can still grow.
 */
export async function eligibleMemberCount(monthKey: string): Promise<number> {
  const { start, end } = monthWindow(monthKey);
  const admin = createServiceClient();
  const excluded = await nonCountingTiers();
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
    if (excluded.has(r.tier)) continue;
    if (r.source && EXCLUDED_SOURCES.has(r.source)) continue;
    members.add(r.profile_id);
  }
  return members.size;
}

// ---------------------------------------------------------------------------
// The speaker card, in one call
// ---------------------------------------------------------------------------

/**
 * The two flags that decide whether a speaker is on the revenue share.
 * They answer different questions and are set by different people:
 *
 *   tslsMainSpeaker — WHO the speaker is. TSLS mainstage speakers are
 *     unpaid on Momentum+ (their month is part of the Summit engagement),
 *     and the TSLS pull sets this itself from the lineup.
 *   paymentAccess — an admin DECISION about one speaker (migration 0082):
 *     may they use the payment feature at all. Only an admin sets it, in
 *     Admin -> Speakers; the TSLS bridge and Speaker Studio never write it.
 *
 * Both suppress money, so they overlap without contradicting: a speaker is
 * paid only when payment access is on AND they are not a TSLS Main Speaker.
 * paymentAccess reads true whenever the column is missing or null, so a
 * database that hasn't run 0082 behaves exactly as it did before.
 */
export interface SpeakerPayFlags {
  tslsMainSpeaker: boolean;
  paymentAccess: boolean;
}

export function speakerIsPaid(flags: SpeakerPayFlags): boolean {
  return flags.paymentAccess && !flags.tslsMainSpeaker;
}

/*
 * §14 of the Leadership Advisor Agreement gives a featured month a single
 * 15% share. When two Advisors share a month they split that one share —
 * they do not each earn 15%, which is what this used to compute.
 *
 * ONLY PAYABLE SPEAKERS DIVIDE IT. A TSLS Main Speaker's Momentum+ month is
 * part of their Summit engagement and carries no Momentum+ payment (Matt,
 * 2026-08-11), and a speaker whose payment access an admin switched off
 * (migration 0082) is likewise not owed anything. Neither takes a slice, so
 * neither may dilute one: an Advisor sharing a month with two Main Speakers
 * still earns the whole 15%.
 *
 * Rounding is per speaker rather than distributing a pooled remainder. With
 * an odd pool the halves can sum to one cent over it — immaterial against a
 * monthly-equivalent figure that itself moves until the month closes, and
 * the alternative needs a stable payout order this data has no basis for.
 */
export function speakerShareCents(
  revenueCents: number,
  payableSpeakers: number,
): number {
  // max(1): a paid speaker is always one of the sharers, so 0 only shows up
  // if the count query came back empty — never inflate the share on that.
  return Math.round(
    (revenueCents * SPEAKER_REVENUE_SHARE) / Math.max(1, payableSpeakers),
  );
}

/**
 * How many speakers holding `monthKey` are actually owed money. Archived and
 * expired speaker records are excluded on the same terms the Studio uses to
 * resolve a speaker at all — a lapsed record is not a claim on the month.
 */
export async function payableSpeakerCountForMonth(
  monthKey: string,
): Promise<number> {
  const admin = createServiceClient();
  let rows = (
    await admin
      .from("speakers")
      .select("id, tsls_main_speaker, payment_access, archived_at, expires_at")
      .eq("speaker_month", monthKey)
  ).data as Record<string, unknown>[] | null;
  if (!rows) {
    // Pre-0082 (no payment_access): everyone still has it by default.
    rows = (
      await admin
        .from("speakers")
        .select("id, tsls_main_speaker, archived_at, expires_at")
        .eq("speaker_month", monthKey)
    ).data as Record<string, unknown>[] | null;
  }
  if (!rows) return 0;
  return rows.filter(
    (r) =>
      sponsorActive({
        archivedAt: (r.archived_at as string | null) ?? null,
        expiresAt: (r.expires_at as string | null) ?? null,
      }) &&
      speakerIsPaid({
        tslsMainSpeaker: r.tsls_main_speaker === true,
        // Absent/null means "has access" — only an explicit false removes it.
        paymentAccess: r.payment_access !== false,
      }),
  ).length;
}

export interface SpeakerMonthStats {
  monthKey: string;
  monthLabel: string;
  memberCount: number;
  /** Total monthly-equivalent revenue for the month; null = Stripe not
      connected (the card says so instead of showing $0). */
  revenueCents: number | null;
  /** 15% share — null when the speaker isn't paid (TSLS Main Speaker, or
      payment access switched off) or revenue is unknown. Already divided by
      `payableSpeakers` when a month is shared (§14). */
  earningsCents: number | null;
  /** How many speakers are splitting this month's single 15% share. 1 in the
      ordinary case; 0 only when nobody holding the month is payable. Surfaced
      so a shared month can say WHY the figure is a half rather than leaving a
      speaker to think the number is wrong. */
  payableSpeakers: number;
  /** True while the month hasn't ended (numbers still moving). */
  inProgress: boolean;
}

export async function speakerMonthStats(
  speakerMonth: string,
  opts: { paid: boolean },
): Promise<SpeakerMonthStats> {
  // The split is applied HERE rather than at the three call sites (the
  // Studio card, the admin table, the monthly report cron) so none of them
  // can compute an undivided 15% by forgetting to ask.
  const [memberCount, revenueCents, payableSpeakers] = await Promise.all([
    eligibleMemberCount(speakerMonth),
    monthlyEquivalentRevenueCents(speakerMonth),
    payableSpeakerCountForMonth(speakerMonth),
  ]);
  return {
    monthKey: speakerMonth,
    monthLabel: monthLabel(speakerMonth),
    memberCount,
    revenueCents,
    earningsCents:
      opts.paid && revenueCents !== null
        ? speakerShareCents(revenueCents, payableSpeakers)
        : null,
    payableSpeakers,
    inProgress: monthWindow(speakerMonth).end.getTime() > Date.now(),
  };
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

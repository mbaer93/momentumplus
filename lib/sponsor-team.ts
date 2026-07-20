import { getAdminAccess } from "@/lib/auth-helpers";
import { provisionMember } from "@/lib/onboarding";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Sponsor team model (Matt, 2026-07-18):
 * - The sponsorship includes ONE free Momentum+ membership — held by the
 *   seat with role 'owner' (the primary manager, who completed onboarding).
 * - Each sponsor tier includes a number of free VIP access tickets
 *   (admin-set, default 0). A ticket = a standard 3-month VIP Access comp
 *   plus a role-'member' seat tying that person to the sponsor.
 * - 'manager' seats may edit the sponsor page. Only members on a REGULAR
 *   membership (one not comped through a sponsorship) can be promoted —
 *   co-managing must never hand out free access.
 * - The owner can transfer ownership; the free membership follows it.
 * - Super Admins can do all of this on any sponsor.
 */

export type SponsorRole = "owner" | "manager" | "member";

const TICKET_SETTINGS_KEY = "sponsor_ticket_counts";

/** Per-sponsor-tier VIP ticket allotments (admin-set; missing tier = 0). */
export async function getTicketCounts(): Promise<Record<string, number>> {
  const { data } = await createServiceClient()
    .from("app_settings")
    .select("value")
    .eq("key", TICKET_SETTINGS_KEY)
    .maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [tier, n] of Object.entries(value)) {
    const num = Number(n);
    if (Number.isFinite(num) && num >= 0) counts[tier] = Math.floor(num);
  }
  return counts;
}

export async function saveTicketCounts(
  counts: Record<string, number>,
): Promise<{ error: string | null }> {
  const { error } = await createServiceClient()
    .from("app_settings")
    .upsert(
      { key: TICKET_SETTINGS_KEY, value: counts, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return { error: error?.message ?? null };
}

export interface SponsorSeat {
  profileId: string;
  name: string;
  email: string;
  role: SponsorRole;
  /** Holds an active membership NOT comped through a sponsorship — the
      eligibility bar for co-manager. */
  regularMember: boolean;
  /** Holds a VIP-ticket comp (tier=vip, source=sponsor) — this is what a
      consumed ticket looks like. */
  vipTicket: boolean;
}

/** The sponsor's team, with manager-eligibility resolved. */
export async function listSponsorTeam(
  sponsorId: string,
): Promise<SponsorSeat[]> {
  const admin = createServiceClient();
  const { data: seats, error } = await admin
    .from("sponsor_members")
    .select("profile_id, role")
    .eq("sponsor_id", sponsorId);
  if (error || !seats?.length) return [];

  const ids = seats.map((s) => s.profile_id as string);
  const now = Date.now();
  const [{ data: profiles }, { data: regularRows }, { data: vipRows }] =
    await Promise.all([
      admin.from("profiles").select("id, full_name, email").in("id", ids),
      // A "regular" membership (non-sponsor-comped) is what makes someone
      // eligible to co-manage.
      admin
        .from("memberships")
        .select("profile_id, status, access_expires_at")
        .in("profile_id", ids)
        .neq("source", "sponsor")
        .in("status", ["active", "past_due", "canceled"]),
      // A VIP-ticket comp specifically — used to count tickets consumed.
      admin
        .from("memberships")
        .select("profile_id, status, access_expires_at")
        .in("profile_id", ids)
        .eq("source", "sponsor")
        .eq("tier", "vip")
        .in("status", ["active", "past_due", "canceled"]),
    ]);
  const byId = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string) || "", email: (p.email as string) || "" },
    ]),
  );
  const grants = (m: { status: string; access_expires_at: string | null }) => {
    const exp = m.access_expires_at;
    return exp === null ? m.status === "active" : new Date(exp).getTime() > now;
  };
  const regular = new Set(
    (regularRows ?? []).filter(grants).map((m) => m.profile_id as string),
  );
  const vipComp = new Set(
    (vipRows ?? []).filter(grants).map((m) => m.profile_id as string),
  );

  const roleRank: Record<SponsorRole, number> = { owner: 0, manager: 1, member: 2 };
  return seats
    .map((s) => ({
      profileId: s.profile_id as string,
      name: byId.get(s.profile_id as string)?.name ?? "",
      email: byId.get(s.profile_id as string)?.email ?? "",
      role: ((s.role as string) ?? "member") as SponsorRole,
      regularMember: regular.has(s.profile_id as string),
      vipTicket: vipComp.has(s.profile_id as string),
    }))
    .sort(
      (a, b) =>
        roleRank[a.role] - roleRank[b.role] ||
        (a.name || a.email).localeCompare(b.name || b.email),
    );
}

/** VIP tickets consumed: seats actually holding a VIP-ticket comp — NOT
    co-managers or admin-linked Pro seats, which are non-owner seats too. */
export function ticketsUsed(team: SponsorSeat[]): number {
  return team.filter((s) => s.vipTicket).length;
}

export interface SponsorActor {
  ok: boolean;
  message?: string;
  userId?: string;
  /** The actor's seat role on this sponsor (null when acting as admin). */
  role?: SponsorRole | null;
  isSuperAdmin?: boolean;
}

/**
 * Who is acting on this sponsor's team? Owners (and managers, where
 * allowed) act on their own page; Super Admins can act on any sponsor.
 */
export async function resolveSponsorActor(
  sponsorId: string,
): Promise<SponsorActor> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in first." };

  const admin = createServiceClient();
  const { data: seat } = await admin
    .from("sponsor_members")
    .select("role")
    .eq("sponsor_id", sponsorId)
    .eq("profile_id", user.id)
    .maybeSingle();
  const role = seat
    ? ((((seat as { role?: string }).role as string) ?? "member") as SponsorRole)
    : null;
  const access = await getAdminAccess();
  return {
    ok: true,
    userId: user.id,
    role,
    isSuperAdmin: access?.role === "super",
  };
}

/**
 * A sponsor's VIP ticket allotment: their per-sponsor override when the
 * admin set one, otherwise the tier default from app_settings.
 */
export async function sponsorTicketAllotment(sponsorId: string): Promise<number> {
  const admin = createServiceClient();
  const counts = await getTicketCounts();
  let res = await admin
    .from("sponsors")
    .select("tier, ticket_override")
    .eq("id", sponsorId)
    .maybeSingle();
  if (res.error && /ticket_override/.test(res.error.message)) {
    // Pre-migration-0041 fallback: no override column yet.
    res = (await admin
      .from("sponsors")
      .select("tier")
      .eq("id", sponsorId)
      .maybeSingle()) as typeof res;
  }
  const row = res.data as { tier?: string; ticket_override?: number | null } | null;
  if (!row) return 0;
  if (typeof row.ticket_override === "number" && row.ticket_override >= 0) {
    return Math.floor(row.ticket_override);
  }
  return counts[row.tier ?? ""] ?? 0;
}

/*
 * Momentum+ Pro tickets (Matt, 2026-07-20): admin grants a chosen sponsor a
 * number of FULL Pro memberships — one year each — that the sponsor hands
 * out like VIP tickets. Granted per sponsor (no tier defaults) and tracked
 * in app_settings: { [sponsorId]: { total, used: [profileId…] } }. The used
 * list is the consumption record — admin-linked Pro seats and the owner's
 * own Pro-equivalent access never count against the allotment.
 */
const PRO_TICKET_SETTINGS_KEY = "sponsor_pro_tickets";

interface ProTicketState {
  total: number;
  used: string[];
}

async function readProTickets(): Promise<Record<string, ProTicketState>> {
  const { data } = await createServiceClient()
    .from("app_settings")
    .select("value")
    .eq("key", PRO_TICKET_SETTINGS_KEY)
    .maybeSingle();
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  const out: Record<string, ProTicketState> = {};
  for (const [id, v] of Object.entries(raw)) {
    const o = (v ?? {}) as { total?: unknown; used?: unknown };
    const total = Number(o.total);
    out[id] = {
      total: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0,
      used: Array.isArray(o.used) ? (o.used as unknown[]).map(String) : [],
    };
  }
  return out;
}

async function writeProTickets(
  all: Record<string, ProTicketState>,
): Promise<{ error: string | null }> {
  const { error } = await createServiceClient()
    .from("app_settings")
    .upsert(
      {
        key: PRO_TICKET_SETTINGS_KEY,
        value: all,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  return { error: error?.message ?? null };
}

/** A sponsor's Pro-ticket standing: how many granted, how many consumed. */
export async function sponsorProTickets(
  sponsorId: string,
): Promise<{ total: number; used: number }> {
  const all = await readProTickets();
  const s = all[sponsorId] ?? { total: 0, used: [] };
  return { total: s.total, used: s.used.length };
}

/** All sponsors' Pro-ticket standings keyed by sponsor id (admin panel). */
export async function allSponsorProTickets(): Promise<
  Record<string, { total: number; used: number }>
> {
  const all = await readProTickets();
  return Object.fromEntries(
    Object.entries(all).map(([id, s]) => [
      id,
      { total: s.total, used: s.used.length },
    ]),
  );
}

/** Admin grant: set how many year-long Pro tickets this sponsor may hand
    out. Already-consumed tickets are never revoked by lowering the number. */
export async function setSponsorProTickets(
  sponsorId: string,
  total: number,
): Promise<{ error: string | null }> {
  const all = await readProTickets();
  const current = all[sponsorId] ?? { total: 0, used: [] };
  const next = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  if (next === 0 && current.used.length === 0) {
    delete all[sponsorId];
  } else {
    all[sponsorId] = { ...current, total: next };
  }
  return writeProTickets(all);
}

export interface TicketInviteSummary {
  invited: string[];
  existing: string[];
  failed: { email: string; reason: string }[];
  remaining: number;
}

/**
 * Hand out VIP tickets: for each email, provision a 3-month VIP Access
 * membership (source=sponsor) and tie them to the sponsor with a
 * role-'member' seat. Enforces the sponsor's ticket allotment (per-sponsor
 * override, else tier default). The caller has already authorized the actor.
 */
export async function inviteTicketUsers(
  sponsor: { id: string },
  rawEmails: string[],
): Promise<TicketInviteSummary> {
  const admin = createServiceClient();
  const [team, allotment] = await Promise.all([
    listSponsorTeam(sponsor.id),
    sponsorTicketAllotment(sponsor.id),
  ]);
  let remaining = Math.max(0, allotment - ticketsUsed(team));

  const summary: TicketInviteSummary = {
    invited: [],
    existing: [],
    failed: [],
    remaining,
  };
  const seen = new Set(team.map((s) => s.email.toLowerCase()));
  const emails = Array.from(
    new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  );

  for (const email of emails) {
    if (seen.has(email)) {
      summary.existing.push(email);
      continue;
    }
    if (remaining <= 0) {
      summary.failed.push({ email, reason: "no tickets left" });
      continue;
    }
    const res = await provisionMember({
      email,
      tier: "vip",
      months: 3,
      source: "sponsor",
    });
    if (!res.ok) {
      summary.failed.push({ email, reason: res.message ?? "couldn't invite" });
      continue;
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .maybeSingle();
    if (!profile) {
      summary.failed.push({ email, reason: "account created but profile not found" });
      continue;
    }
    // ignoreDuplicates: never downgrade an existing seat's role.
    await admin
      .from("sponsor_members")
      .upsert(
        { sponsor_id: sponsor.id, profile_id: profile.id, role: "member" },
        { onConflict: "sponsor_id,profile_id", ignoreDuplicates: true },
      );
    seen.add(email);
    remaining -= 1;
    summary.invited.push(email);
  }
  summary.remaining = remaining;
  return summary;
}

/**
 * Hand out Momentum+ Pro tickets: for each email, provision a FULL Pro
 * membership for one year (source=sponsor) and tie them to the sponsor with
 * a role-'member' seat. Enforces the sponsor's admin-granted allotment and
 * records consumption in app_settings so admin-linked Pro seats never count
 * against it.
 */
export async function inviteProTicketUsers(
  sponsor: { id: string },
  rawEmails: string[],
): Promise<TicketInviteSummary> {
  const admin = createServiceClient();
  const [team, all] = await Promise.all([
    listSponsorTeam(sponsor.id),
    readProTickets(),
  ]);
  const state = all[sponsor.id] ?? { total: 0, used: [] };
  let remaining = Math.max(0, state.total - state.used.length);

  const summary: TicketInviteSummary = {
    invited: [],
    existing: [],
    failed: [],
    remaining,
  };
  const seen = new Set(team.map((s) => s.email.toLowerCase()));
  const emails = Array.from(
    new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  );

  for (const email of emails) {
    if (seen.has(email)) {
      summary.existing.push(email);
      continue;
    }
    if (remaining <= 0) {
      summary.failed.push({ email, reason: "no Pro tickets left" });
      continue;
    }
    const res = await provisionMember({
      email,
      tier: "pro",
      months: 12,
      source: "sponsor",
    });
    if (!res.ok) {
      summary.failed.push({ email, reason: res.message ?? "couldn't invite" });
      continue;
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .maybeSingle();
    if (!profile) {
      summary.failed.push({ email, reason: "account created but profile not found" });
      continue;
    }
    // ignoreDuplicates: never downgrade an existing seat's role.
    await admin
      .from("sponsor_members")
      .upsert(
        { sponsor_id: sponsor.id, profile_id: profile.id, role: "member" },
        { onConflict: "sponsor_id,profile_id", ignoreDuplicates: true },
      );
    state.used.push(profile.id as string);
    seen.add(email);
    remaining -= 1;
    summary.invited.push(email);
  }
  if (summary.invited.length > 0) {
    all[sponsor.id] = state;
    await writeProTickets(all);
  }
  summary.remaining = remaining;
  return summary;
}

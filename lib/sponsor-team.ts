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
  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", ids),
    admin
      .from("memberships")
      .select("profile_id, status, access_expires_at, source")
      .in("profile_id", ids)
      .neq("source", "sponsor")
      .in("status", ["active", "past_due", "canceled"]),
  ]);
  const byId = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string) || "", email: (p.email as string) || "" },
    ]),
  );
  const regular = new Set<string>();
  for (const m of memberships ?? []) {
    const exp = m.access_expires_at as string | null;
    const grants =
      exp === null ? m.status === "active" : new Date(exp).getTime() > now;
    if (grants) regular.add(m.profile_id as string);
  }

  const roleRank: Record<SponsorRole, number> = { owner: 0, manager: 1, member: 2 };
  return seats
    .map((s) => ({
      profileId: s.profile_id as string,
      name: byId.get(s.profile_id as string)?.name ?? "",
      email: byId.get(s.profile_id as string)?.email ?? "",
      role: ((s.role as string) ?? "member") as SponsorRole,
      regularMember: regular.has(s.profile_id as string),
    }))
    .sort(
      (a, b) =>
        roleRank[a.role] - roleRank[b.role] ||
        (a.name || a.email).localeCompare(b.name || b.email),
    );
}

/** Tickets already consumed: every seat that isn't the owner's. */
export function ticketsUsed(team: SponsorSeat[]): number {
  return team.filter((s) => s.role !== "owner").length;
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

export interface TicketInviteSummary {
  invited: string[];
  existing: string[];
  failed: { email: string; reason: string }[];
  remaining: number;
}

/**
 * Hand out VIP tickets: for each email, provision a 3-month VIP Access
 * membership (source=sponsor) and tie them to the sponsor with a
 * role-'member' seat. Enforces the tier's ticket allotment. The caller has
 * already authorized the actor.
 */
export async function inviteTicketUsers(
  sponsor: { id: string; tier: string },
  rawEmails: string[],
): Promise<TicketInviteSummary> {
  const admin = createServiceClient();
  const team = await listSponsorTeam(sponsor.id);
  const counts = await getTicketCounts();
  const allotment = counts[sponsor.tier] ?? 0;
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

import { redirect } from "next/navigation";
import { tierLabel } from "./access";
import { effectiveMembership } from "./membership";
import { initials, placeholderProfile } from "./placeholder-data";
import { createClient, getAuthUser } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { Membership, Tier } from "./types";
import { requestCache } from "@/lib/request-cache";
import { readViewAsCookie, viewAsStateFor } from "./view-as";
import { testersLive } from "./testers";
import { getAccessMatrix, findTier } from "./tiers";

export interface CurrentMember {
  name: string;
  email: string;
  initials: string;
  tier: Tier;
  tierLabel: string;
  isAdmin: boolean;
  /** Has an active speaker record — unlocks the Speaker Studio. */
  isSpeaker: boolean;
  /** Owns or manages a sponsor page — unlocks the Sponsor Studio. */
  isSponsorManager: boolean;
  /** Admin-set title (relative to Momentum+/TSLS) shown on their chat messages. */
  adminTitle: string | null;
  /** False when every membership has lapsed → portal layout sends to /expired. */
  membershipActive: boolean;
  /** Set while a Super Admin is previewing the portal as another tier. */
  viewingAs: { tier: string; label: string } | null;
  /** False until the member has given their name — portal requires it on
      first login (they're sent to the /welcome profile step). */
  profileComplete: boolean;
  /** A live speaker whose onboarding form is fully filled in. True for
      everyone who is not a speaker, and for admins (who are exempt so a
      thin speaker page cannot lock them out of the admin panel). */
  speakerSetupComplete: boolean;
  /** A test account: full tier access, hidden from every member-facing list. */
  isTester: boolean;
  /** Sees the app as it will be at launch — admins always, testers once the
      rehearsal switch is on (lib/testers.ts). Lifts the LAUNCH gate only;
      tier grants still apply, so a tester rehearses their own tier. */
  seesLaunchedApp: boolean;
  accessExpiresAt: string | null;
}

/**
 * Resolve the member rendered in the portal shell.
 *
 * With Supabase configured this reads the real profile + memberships and picks
 * the most privileged row that still grants access (grace semantics included).
 * Returns null when nobody is signed in (middleware normally prevents this).
 * In preview mode (no Supabase env) it returns the placeholder member.
 */
/**
 * Portal-page guard: signed-in member with an active membership, or redirect
 * (login when signed out, /expired when the membership lapsed — SPEC.md §5).
 */
export async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  if (!member.membershipActive) redirect("/expired");
  // First login without a name (email-only invites, magic links): the
  // directory and chat would show a bare email address, so collect the
  // name before opening the portal.
  // Full welcome, not ?step=profile: a member with no name yet has almost
  // certainly never onboarded, and the profile-only shortcut silently
  // skipped the set-a-password step (Matt, 2026-07-30: invitees who signed
  // in via a magic link were never prompted). Step 1 offers a skip for the
  // rare already-passworded member who's only missing their name.
  if (!member.profileComplete) redirect("/welcome");
  /*
   * A speaker who has not finished setup gets the form, not the portal —
   * on their FIRST page load, not whenever they next open the Studio. This
   * covers both the new invitee and the one already inside: the check reads
   * the speaker row every request, so it applies the moment this deploys.
   *
   * Admins are exempt (see getCurrentMember) so an admin who is also a
   * speaker can still reach the tools to fix it.
   */
  if (!member.speakerSetupComplete) redirect("/speaker-onboarding");
  return member;
}

/*
 * requestCache(): the portal layout and nearly every page resolve the member
 * independently — this dedupes them to one auth call + one query pair per
 * request instead of one per call site.
 */
export const getCurrentMember = requestCache(
  async (): Promise<CurrentMember | null> => {
  if (!isSupabaseConfigured()) {
    const tier = placeholderProfile.tier;
    return {
      name: placeholderProfile.full_name,
      email: placeholderProfile.email,
      initials: initials(placeholderProfile.full_name),
      tier,
      tierLabel: tierLabel(tier),
      isAdmin: tier === "admin",
      isSpeaker: true, // preview shows the Studio for demo purposes
      isSponsorManager: true,
      adminTitle: tier === "admin" ? "Momentum+ Team" : null,
      membershipActive: true,
      profileComplete: true,
      speakerSetupComplete: true,
      isTester: false,
      seesLaunchedApp: tier === "admin",
      accessExpiresAt: null,
      viewingAs: null,
    };
  }

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return null;

  const [
    { data: profileRow },
    { data: memberships },
    { data: speakerRow },
    sponsorSeats,
  ] = await Promise.all([
    supabase
      .from("profiles")
      // `tester` rides along: it decides both what this member can reach
      // before launch and whether anyone else can see them.
      .select("full_name, email, admin_title, admin_role, tester")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("tier, status, access_starts_at, access_expires_at")
      .eq("profile_id", user.id),
    supabase
      .from("speakers")
      // The page fields ride along for the setup gate — same row, same query.
      .select("id, archived_at, expires_at, name, title, bio, industries, resource_id")
      .eq("profile_id", user.id)
      .maybeSingle(),
    // Own seats via RLS (migration 0039). Errors (pre-migration) → no studio.
    supabase
      .from("sponsor_members")
      .select("role")
      .eq("profile_id", user.id)
      .in("role", ["owner", "manager"]),
  ]);

  /*
   * `tester` arrives with migration 0089. Between the deploy and the
   * migration this select fails as a whole, and a null profile here is not a
   * cosmetic loss — it drops full_name (→ everyone bounced to /welcome),
   * email, and admin_role (→ every admin demoted). Same pre-migration
   * ladder the rest of the app uses.
   */
  const profile =
    profileRow ??
    (
      await supabase
        .from("profiles")
        .select("full_name, email, admin_title, admin_role")
        .eq("id", user.id)
        .maybeSingle()
    ).data;

  const name = profile?.full_name || user.email || "Member";
  const rows = (memberships ?? []) as Pick<
    Membership,
    "tier" | "status" | "access_starts_at" | "access_expires_at"
  >[];
  const effective = effectiveMembership(rows);

  const realTier: Tier = effective?.tier ?? "tsls_attendee";
  const realIsAdmin = effective?.tier === "admin";

  const isTester = (profile as { tester?: boolean } | null)?.tester === true;
  // Only asked when it can matter — the settings read is cached per request,
  // but a non-tester's answer never depends on it.
  const rehearsalOn = isTester ? await testersLive() : false;

  /*
   * Speaker setup gate (Matt, 2026-08-14: "how do we ensure they must
   * complete the form before they access the app?").
   *
   * #223 blocked the Studio. That is not the app — a half-set-up speaker
   * could still browse sessions, the library and the community, and the one
   * who already got in would only be stopped if they happened to open the
   * Studio. This stops them at the portal door instead, on the next page
   * they load rather than the next time they think to visit /speaker.
   *
   * ADMINS ARE EXEMPT. An admin who also has a speaker row would otherwise
   * be locked out of the admin panel by their own speaker profile — losing
   * the ability to fix it is a worse failure than a thin speaker page.
   *
   * The completeness rule itself lives in ONE place (speakerSetupGaps) and
   * runs against the service role. Computing it here against the signed-in
   * user's client instead put this gate and the setup page on different
   * readings of the same speaker: `resources` is only readable under RLS
   * while it is active and within the member's access level, so an admin
   * deactivating a speaker's business page made the portal say "incomplete"
   * and setup say "nothing pending" — a closed loop with no way into either.
   */
  const liveSpeaker =
    speakerRow &&
    !(speakerRow as { archived_at?: string | null }).archived_at &&
    (!(speakerRow as { expires_at?: string | null }).expires_at ||
      new Date((speakerRow as { expires_at: string }).expires_at) > new Date());

  let speakerSetupComplete = true;
  if (liveSpeaker && !realIsAdmin) {
    const s = speakerRow as {
      name?: string | null;
      title?: string | null;
      bio?: string | null;
      industries?: string[] | null;
      resource_id?: string | null;
    };
    // Fails OPEN (see speakerSetupGaps): a lookup that errors returns no
    // gaps rather than locking a speaker out of the whole portal on the
    // strength of a query that did not run.
    const { speakerSetupGaps } = await import("@/lib/speaker-tools");
    speakerSetupComplete =
      (
        await speakerSetupGaps(
          {
            name: s.name ?? null,
            title: s.title ?? null,
            bio: s.bio ?? null,
            industries: s.industries ?? null,
            resourceId: s.resource_id ?? null,
          },
          user.id,
        )
      ).length === 0;
  }

  /*
   * View as: an admin previewing the portal as another tier (any admin, not
   * just Super — Matt, 2026-08-05). Only ever narrows — the cookie is
   * checked against the signer's REAL admin role on every request, so it
   * does nothing in anyone else's browser.
   *
   * The tier registry names Lite and any Control-Center-created tier that the
   * static label map doesn't know — resolve the plan label against it below.
   */
  const matrix = await getAccessMatrix();
  const requested = realIsAdmin ? await readViewAsCookie() : null;
  let viewingAs: CurrentMember["viewingAs"] = null;
  let simulated: ReturnType<typeof viewAsStateFor> | null = null;
  if (requested) {
    const known = findTier(matrix, requested);
    if (known) {
      simulated = viewAsStateFor(requested);
      viewingAs = { tier: known.slug, label: known.label };
    }
  }

  return {
    name,
    email: profile?.email ?? user.email ?? "",
    initials: initials(name),
    tier: simulated ? (simulated.tier as Tier) : realTier,
    tierLabel: simulated
      ? (viewingAs?.label ?? tierLabel(realTier, matrix))
      : effective
        ? tierLabel(realTier, matrix)
        : "Membership lapsed",
    isAdmin: simulated ? simulated.isAdmin : realIsAdmin,
    isSpeaker: simulated
      ? simulated.isSpeaker
      : Boolean(
      speakerRow &&
        !(speakerRow as { archived_at?: string | null }).archived_at &&
        (!(speakerRow as { expires_at?: string | null }).expires_at ||
          new Date(
            (speakerRow as { expires_at: string }).expires_at,
          ) > new Date()),
    ),
    isSponsorManager: simulated
      ? simulated.isSponsorManager
      : Boolean(sponsorSeats.data?.length),
    adminTitle:
      (simulated ? simulated.isAdmin : realIsAdmin)
        ? (profile?.admin_title ?? null)
        : null,
    membershipActive: effective !== null,
    speakerSetupComplete,
    isTester,
    /*
     * View-as is a role preview, not a person preview: an admin previewing
     * "Member" keeps their own launch visibility, because the point of the
     * preview is to check the launch before it happens. Testers get it from
     * the rehearsal switch.
     */
    seesLaunchedApp: realIsAdmin || (isTester && rehearsalOn),
    profileComplete: Boolean(profile?.full_name?.trim()),
    accessExpiresAt: effective?.access_expires_at ?? null,
    viewingAs,
  };
});

import {
  ProfileView,
  type ProfileActivityRow,
  type ProfileSessionRow,
} from "@/components/profile/ProfileView";
import { CalendarSmallIcon, CheckIcon } from "@/components/icons";
import { requireMember } from "@/lib/current-member";
import { mergePrefs, PREF_DEFINITIONS, type PrefRow } from "@/lib/notifications";
import { placeholderStats } from "@/lib/placeholder-data";
import { listSessions } from "@/lib/sessions/queries";
import {
  dayOfMonth,
  displayStatus,
  monthShort,
  timeLabel,
} from "@/lib/sessions/view";
import { isPro } from "@/lib/access";
import { listCourses, effectiveCeHours } from "@/lib/education";
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/* Account details block: profile row + prefs + membership status + referral.
   One parallel batch (audit P2-15: this page was 12-15 sequential
   round-trips; it's now three parallel phases). */
async function loadAccount() {
  const out = {
    profileRow: null as null | {
      phone: string;
      company: string;
      title: string;
      industry: string;
      bio: string;
      share_contact: boolean;
      admin_title: string;
      created_at: string;
    },
    savedPrefs: [] as Partial<PrefRow>[],
    referral: null as { link: string; count: number } | null,
    hasStripeCustomer: false,
    membershipStatusLabel: "● Active",
  };
  const user = await getAuthUser();
  if (!user) return out;
  const supabase = await createClient();

  const referralPromise = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? (async () => {
        // Referral program: mint the code on first visit; count conversions.
        const { ensureReferralCode, getReferralCount } = await import(
          "@/lib/referrals"
        );
        const code = await ensureReferralCode(user.id);
        if (!code) return null;
        const site =
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
        return { link: `${site}/join?ref=${code}`, count: await getReferralCount(user.id) };
      })()
    : Promise.resolve(null);

  const [profileRes, prefsRes, membershipsRes, referral] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "phone, company, title, industry, bio, share_contact, admin_title, stripe_customer_id, created_at",
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("notification_prefs")
      .select("key, email, sms, in_app")
      .eq("profile_id", user.id),
    supabase
      .from("memberships")
      .select("tier, status, access_expires_at")
      .eq("profile_id", user.id),
    referralPromise,
  ]);
  let p = profileRes.data;
  if (!p) {
    // Pre-migration fallback: share_contact arrives with 0034.
    ({ data: p } = (await supabase
      .from("profiles")
      .select(
        "phone, company, title, industry, bio, admin_title, stripe_customer_id, created_at",
      )
      .eq("id", user.id)
      .maybeSingle()) as { data: typeof p });
  }
  if (p) {
    out.profileRow = {
      phone: p.phone ?? "",
      company: p.company ?? "",
      title: p.title ?? "",
      industry: p.industry ?? "",
      bio: p.bio ?? "",
      share_contact: Boolean((p as { share_contact?: boolean }).share_contact),
      admin_title: p.admin_title ?? "",
      created_at: p.created_at,
    };
    out.hasStripeCustomer = Boolean(p.stripe_customer_id);
  }
  out.savedPrefs = (prefsRes.data ?? []) as Partial<PrefRow>[];
  out.referral = referral;

  // Honest status: past_due and canceled members are still in the portal
  // (grace semantics) — "Active" must not paper over that.
  const { effectiveMembership } = await import("@/lib/membership");
  const eff = effectiveMembership(
    (membershipsRes.data ?? []) as {
      tier: import("@/lib/types").Tier;
      status: import("@/lib/types").MembershipStatus;
      access_expires_at: string | null;
    }[],
  );
  if (eff?.status === "past_due") {
    out.membershipStatusLabel = "● Past due — payment needed";
  } else if (eff?.status === "canceled") {
    out.membershipStatusLabel = "● Canceled — access until period end";
  }
  return out;
}

export default async function ProfilePage() {
  const member = await requireMember();
  const preview = !isSupabaseConfigured();

  // Phase 1 — everything that doesn't depend on another load.
  const [account, courses, stripeSettings, all] = await Promise.all([
    loadAccount(),
    listCourses(),
    getStripeSettings(),
    listSessions(),
  ]);

  // Profile details + saved prefs. The illustrative defaults are for
  // preview mode only — configured mode always reads the real row.
  const profileRow =
    account.profileRow ??
    (preview
      ? {
          phone: "",
          company: "Momentum Advisory",
          title: "Executive Coach",
          industry: "Leadership Development",
          bio: "",
          share_contact: false,
          admin_title: "",
          created_at: "2024-11-12T00:00:00.000Z",
        }
      : {
          phone: "",
          company: "",
          title: "",
          industry: "",
          bio: "",
          share_contact: false,
          admin_title: "",
          created_at: new Date().toISOString(),
        });
  const { savedPrefs, referral, hasStripeCustomer, membershipStatusLabel } =
    account;

  // Earned certificates: courses with every lesson complete (viewer-scoped
  // via RLS); completion date = the last lesson's completed_at.
  const earnedCourses = courses.filter(
    (c) => c.published && c.lessons.length > 0 && c.lessons.every((l) => l.completed),
  );

  // Learning record: the member's enrolled sessions (CLAUDE.md rule #4 —
  // enrollments, attendance, and notes feed the member profile stats).
  const now = Date.now();
  const mine = all
    .filter((s) => s.isEnrolled)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  // Phase 2 — loads that need Phase 1's lists. Own rows only in both:
  // admins can read everyone's progress via RLS, and another member's
  // rows must never stamp this member's profile.
  const [completionDates, notesBySession] = await Promise.all([
    (async () => {
      const dates = new Map<string, string>();
      if (!isSupabaseConfigured() || earnedCourses.length === 0) return dates;
      const user = await getAuthUser();
      if (!user) return dates;
      const lessonToCourse = new Map<string, string>();
      for (const c of earnedCourses) {
        for (const l of c.lessons) lessonToCourse.set(l.id, c.id);
      }
      const supabase = await createClient();
      const { data: progress } = await supabase
        .from("lesson_progress")
        .select("lesson_id, completed_at")
        .eq("profile_id", user.id)
        .in("lesson_id", [...lessonToCourse.keys()]);
      for (const row of progress ?? []) {
        const courseId = lessonToCourse.get(row.lesson_id);
        if (!courseId || !row.completed_at) continue;
        const prev = dates.get(courseId);
        if (!prev || row.completed_at > prev) dates.set(courseId, row.completed_at);
      }
      return dates;
    })(),
    (async () => {
      // The member's own private notes, surfaced next to each session in
      // the learning record (Matt, 2026-08-05).
      const notes = new Map<string, string>();
      if (!isSupabaseConfigured() || mine.length === 0) return notes;
      const user = await getAuthUser();
      if (!user) return notes;
      const supabase = await createClient();
      const { data: noteRows } = await supabase
        .from("session_notes")
        .select("session_id, body")
        .eq("profile_id", user.id)
        .in(
          "session_id",
          mine.map((s) => s.id),
        );
      for (const row of noteRows ?? []) {
        const body = (row.body ?? "").trim();
        if (body) notes.set(row.session_id, body);
      }
      return notes;
    })(),
  ]);

  const certificates = earnedCourses.map((c) => ({
    courseId: c.id,
    title: c.title,
    ceHours: effectiveCeHours(c),
    dateLabel: new Date(
      completionDates.get(c.id) ?? Date.now(),
    ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  }));

  // Self-serve billing appears once the Super Admin's Stripe wizard is done.
  const billingEnabled = stripeReady(stripeSettings);

  const sessionRows: ProfileSessionRow[] = mine.map((s) => ({
    id: s.slug,
    title: s.title,
    speakerName: s.speaker.name,
    month: monthShort(s.startsAt),
    day: dayOfMonth(s.startsAt),
    timeLabel: timeLabel(s.startsAt),
    status: displayStatus(s, now),
    note: notesBySession.get(s.id),
  }));

  const attendedCount = mine.filter((s) => s.attended).length;

  const activity: ProfileActivityRow[] = mine.slice(0, 5).map((s, i) => ({
    id: `${s.slug}-${i}`,
    icon: s.attended ? <CheckIcon size={14} /> : <CalendarSmallIcon size={14} />,
    iconBg: s.attended ? "rgba(58,112,85,0.1)" : "var(--gold-pale)",
    iconColor: s.attended ? "var(--accent-green)" : "var(--gold)",
    text: s.attended
      ? `You attended ${s.title} with ${s.speaker.name}`
      : `You enrolled in ${s.title} with ${s.speaker.name}`,
    time: new Date(s.startsAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
  }));

  const memberSince = new Date(profileRow.created_at).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" },
  );
  const daysActive = Math.max(
    1,
    Math.floor(
      (now - new Date(profileRow.created_at).getTime()) / (24 * 3600 * 1000),
    ),
  );

  return (
    <ProfileView
      member={{
        name: member.name,
        email: member.email,
        initials: member.initials,
        tierLabel: member.tierLabel,
        accessExpiresAt: member.accessExpiresAt,
        membershipStatusLabel,
        isAdmin: member.isAdmin,
      }}
      profile={{
        phone: profileRow.phone,
        company: profileRow.company,
        title: profileRow.title,
        industry: profileRow.industry,
        bio: profileRow.bio,
        shareContact: profileRow.share_contact,
        adminTitle: profileRow.admin_title,
        memberSince,
      }}
      stats={{
        sessions: preview ? placeholderStats.sessionsAttended : attendedCount,
        daysActive: preview ? placeholderStats.memberSinceDays : daysActive,
      }}
      sessions={sessionRows}
      activity={activity}
      prefDefinitions={PREF_DEFINITIONS}
      initialPrefs={mergePrefs(savedPrefs)}
      certificates={certificates}
      referral={referral}
      billing={{
        enabled: billingEnabled,
        basicPrice: stripeSettings?.displayPrices?.basic ?? null,
        proPrice: stripeSettings?.displayPrices?.pro ?? null,
        hasCustomer: hasStripeCustomer,
        isPro: isPro(member.tier),
        hasActiveMembership: member.membershipActive,
      }}
    />
  );
}

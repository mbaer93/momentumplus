import {
  ProfileView,
  type ProfileActivityRow,
  type ProfileSessionRow,
} from "@/components/profile/ProfileView";
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
import { getStripeSettings, stripeReady } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const member = await requireMember();

  // Profile details + saved prefs. The illustrative defaults are for
  // preview mode only — configured mode always reads the real row.
  const preview = !isSupabaseConfigured();
  let profileRow = preview
    ? {
        phone: "",
        company: "Momentum Advisory",
        title: "Executive Coach",
        industry: "Leadership Development",
        bio: "",
        admin_title: "",
        created_at: "2024-11-12T00:00:00.000Z",
      }
    : {
        phone: "",
        company: "",
        title: "",
        industry: "",
        bio: "",
        admin_title: "",
        created_at: new Date().toISOString(),
      };
  let savedPrefs: Partial<PrefRow>[] = [];
  let hasStripeCustomer = false;

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const [{ data: p }, { data: prefRows }] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "phone, company, title, industry, bio, admin_title, stripe_customer_id, created_at",
          )
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("notification_prefs")
          .select("key, email, sms, in_app")
          .eq("profile_id", user.id),
      ]);
      if (p) {
        profileRow = {
          phone: p.phone ?? "",
          company: p.company ?? "",
          title: p.title ?? "",
          industry: p.industry ?? "",
          bio: p.bio ?? "",
          admin_title: p.admin_title ?? "",
          created_at: p.created_at,
        };
        hasStripeCustomer = Boolean(p.stripe_customer_id);
      }
      savedPrefs = (prefRows ?? []) as Partial<PrefRow>[];
    }
  }

  // Self-serve billing appears once the Super Admin's Stripe wizard is done.
  const stripeSettings = await getStripeSettings();
  const billingEnabled = stripeReady(stripeSettings);

  // Learning record: the member's enrolled sessions (CLAUDE.md rule #4 —
  // enrollments, attendance, and notes feed the member profile stats).
  const all = await listSessions();
  const now = Date.now();
  const mine = all
    .filter((s) => s.isEnrolled)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const sessionRows: ProfileSessionRow[] = mine.map((s) => ({
    id: s.slug,
    title: s.title,
    speakerName: s.speaker.name,
    month: monthShort(s.startsAt),
    day: dayOfMonth(s.startsAt),
    timeLabel: timeLabel(s.startsAt),
    status: displayStatus(s, now),
  }));

  const attendedCount = mine.filter((s) => s.attended).length;

  const activity: ProfileActivityRow[] = mine.slice(0, 5).map((s, i) => ({
    id: `${s.slug}-${i}`,
    icon: s.attended ? "✓" : "Cal",
    iconBg: s.attended ? "rgba(58,112,85,0.1)" : "var(--gold-pale)",
    iconColor: s.attended ? "var(--accent-green)" : "var(--gold)",
    text: s.attended
      ? `You attended <strong>${s.title}</strong> with ${s.speaker.name}`
      : `You enrolled in <strong>${s.title}</strong> with ${s.speaker.name}`,
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
        membershipStatusLabel: "● Active",
        isAdmin: member.isAdmin,
      }}
      profile={{
        phone: profileRow.phone,
        company: profileRow.company,
        title: profileRow.title,
        industry: profileRow.industry,
        bio: profileRow.bio,
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

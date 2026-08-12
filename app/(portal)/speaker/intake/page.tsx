import { redirect } from "next/navigation";
import { AdvisorIntakeForm } from "@/components/speaker/AdvisorIntakeForm";
import { intakeRequired } from "@/lib/advisor-intake";
import { getAdvisorIntake } from "@/lib/advisor-intake-db";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { requireMember } from "@/lib/current-member";
import { monthLabel } from "@/lib/revenue";
import {
  getSpeakerById,
  getSpeakerForUser,
  latestAdvisorAgreement,
} from "@/lib/speaker-tools";
import { getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Session intake | Momentum+" };

function dayLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

/*
 * The Advisor session intake (§§2, 3, 4, 6, 12, 21, 22, 23). Unlike the
 * agreement it gates nothing — it's a working document an Advisor fills in
 * over time. Admins open a specific Advisor's copy with ?as=<speakerId>,
 * read-only, the same convention as the Studio and the agreement.
 */
export default async function AdvisorIntakePage(props: {
  searchParams?: Promise<{ as?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireMember();

  if (!isSupabaseConfigured()) redirect("/speaker");

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const asId = searchParams?.as?.trim();
  let previewAs: string | null = null;
  let speaker;
  if (asId) {
    const access = await getAdminAccess();
    if (!access || !canAccessArea(access, "content")) redirect("/dashboard");
    speaker = await getSpeakerById(asId);
    if (!speaker) redirect("/admin/speakers");
    previewAs = speaker.name;
  } else {
    speaker = await getSpeakerForUser(user.id);
  }
  if (!speaker) redirect("/speaker");

  // TSLS Main Speakers answer the Speaker Tech Questionnaire instead — this
  // intake is for the virtual Advisor session (§6), not the mainstage.
  if (!intakeRequired(speaker)) redirect("/speaker");

  const stored = await getAdvisorIntake(speaker.id);
  // Anything this Advisor has already given us seeds the form; asking twice
  // for the same fact is the friction Matt ruled out (2026-08-12). Phone
  // comes from their own signature snapshot, website from the speaker record.
  const signed = await latestAdvisorAgreement(speaker.id);

  /*
   * Seed a blank intake from what the Advisor already told us on the
   * agreement (§2's anticipated date/time) rather than asking twice. Only
   * when nothing has been saved yet — once there's a row, their own answers
   * win even if they cleared a field on purpose.
   */
  const initial = stored.exists
    ? stored.intake
    : {
        ...stored.intake,
        preferredSessionDate: speaker.featuredSessionDate ?? "",
        preferredSessionTime: speaker.featuredSessionTime ?? "",
        phone: signed?.phone ?? "",
        website: speaker.website ?? "",
      };

  return (
    <AdvisorIntakeForm
      initial={initial}
      submittedAtLabel={dayLabel(stored.submittedAt)}
      updatedAtLabel={dayLabel(stored.updatedAt)}
      featuredMonthLabel={
        speaker.speakerMonth ? monthLabel(speaker.speakerMonth) : null
      }
      readOnly={Boolean(previewAs)}
      previewAs={previewAs}
    />
  );
}

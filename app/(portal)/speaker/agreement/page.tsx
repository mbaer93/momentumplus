import { redirect } from "next/navigation";
import {
  AdvisorAgreementForm,
  type AdvisorAgreementSignature,
} from "@/components/speaker/AdvisorAgreementForm";
import { agreementIsCurrent, agreementRequired } from "@/lib/advisor-agreement";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { requireMember } from "@/lib/current-member";
import { monthLabel } from "@/lib/revenue";
import { getSpeakerById, getSpeakerForUser, latestAdvisorAgreement } from "@/lib/speaker-tools";
import { getAdvisorIntake } from "@/lib/advisor-intake-db";
import { getAgreementForSpeaker } from "@/lib/agreement-doc-db";
import { getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leadership Advisor Agreement | Momentum+",
};

/*
 * The Leadership Advisor Agreement — the gate in front of Speaker Studio.
 *
 * Reachable two ways: an Advisor who hasn't signed is sent here from
 * /speaker, and anyone who has signed can come back to re-read what they
 * agreed to. Admins can open a specific Advisor's copy with ?as=<speakerId>,
 * the same convention Speaker Studio uses, and cannot sign from it.
 */
export default async function AdvisorAgreementPage(props: {
  searchParams?: Promise<{ as?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireMember();

  if (!isSupabaseConfigured()) {
    // Preview mode has no speaker records to gate; the Studio is explorable
    // without Supabase and this page has nothing real to show.
    redirect("/speaker");
  }

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

  // Nothing to sign: a TSLS Main Speaker (§1 — a different role) or someone
  // an admin has waived. Send them where they were trying to go.
  if (!agreementRequired(speaker)) redirect("/speaker");

  /*
   * Anything this Advisor has already given Momentum+ seeds the blanks:
   * asking a second time for a number they typed into their intake — or
   * into a previous signature of this very agreement — is exactly the
   * friction Matt called out (2026-08-11). Their own signature snapshot
   * wins over the intake, being the more deliberate of the two.
   */
  const [latest, intake, agreement] = await Promise.all([
    latestAdvisorAgreement(speaker.id),
    getAdvisorIntake(speaker.id),
    getAgreementForSpeaker(speaker.id),
  ]);
  const knownPhone = latest?.phone || intake.intake.phone || null;
  const knownOrganization =
    speaker.organization || latest?.organization || null;
  const signature: AdvisorAgreementSignature | null = latest
    ? {
        signedName: latest.signedName,
        signedAtLabel: new Date(latest.signedAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "America/New_York",
        }),
        agreementVersion: latest.agreementVersion,
        current: agreementIsCurrent(latest, agreement.currency),
      }
    : null;

  return (
    <AdvisorAgreementForm
      speaker={{
        name: speaker.name,
        organization: knownOrganization,
        phone: knownPhone,
        featuredSessionDate: speaker.featuredSessionDate,
        featuredSessionTime: speaker.featuredSessionTime,
        featuredMonthLabel: speaker.speakerMonth
          ? monthLabel(speaker.speakerMonth)
          : null,
      }}
      email={previewAs ? "" : (user.email ?? "")}
      doc={agreement.doc}
      hasOverrides={agreement.hasOverrides}
      signature={signature}
      readOnly={Boolean(previewAs)}
      previewAs={previewAs}
    />
  );
}

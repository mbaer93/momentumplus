import { redirect } from "next/navigation";
import { TslsIntakeForm } from "@/components/speaker/TslsIntakeForm";
import { tslsIntakeRequired } from "@/lib/tsls-intake";
import { getTslsIntake } from "@/lib/tsls-intake-db";
import { canAccessArea } from "@/lib/admin-perms";
import { getAdminAccess } from "@/lib/auth-helpers";
import { requireMember } from "@/lib/current-member";
import { getSpeakerById, getSpeakerForUser } from "@/lib/speaker-tools";
import { getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Speaker Tech Questionnaire | Momentum+" };

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
 * The TSLS Speaker Tech Questionnaire, for mainstage Summit speakers.
 * Leadership Advisors are sent to their own session intake instead — the
 * two sets never overlap. Admins open a speaker's copy with ?as=<speakerId>,
 * read-only, the same convention as the Studio.
 */
export default async function TslsIntakePage(props: {
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

  if (!tslsIntakeRequired(speaker)) redirect("/speaker");

  const stored = await getTslsIntake(speaker.id);

  /*
   * Seed the three fields Momentum+ already knows rather than asking a
   * speaker to retype what's on their profile. Only before anything is
   * saved — after that their own answers win, including a cleared one.
   */
  const answers = stored.exists
    ? stored.answers
    : {
        ...stored.answers,
        ...(speaker.name ? { name: speaker.name } : {}),
        ...(previewAs ? {} : user.email ? { email: user.email } : {}),
        ...(speaker.website ? { website: speaker.website } : {}),
      };

  return (
    <TslsIntakeForm
      initialAnswers={answers}
      initialSignedName={stored.signedName}
      initialSignedDate={stored.signedDate}
      submittedAtLabel={dayLabel(stored.submittedAt)}
      updatedAtLabel={dayLabel(stored.updatedAt)}
      readOnly={Boolean(previewAs)}
      previewAs={previewAs}
    />
  );
}

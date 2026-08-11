import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AgreementEditor,
  RequireResignatureCard,
} from "@/components/admin/AgreementEditor";
import { diffAgreementDocs } from "@/lib/agreement-diff";
import {
  countAdvisorsHoldingCurrentSignature,
  getAgreementDraft,
  getPublishedAgreement,
  getSpeakerOverride,
} from "@/lib/agreement-doc-db";
import { getAdminAccess } from "@/lib/auth-helpers";
import { requireMember } from "@/lib/current-member";
import { getSpeakerById } from "@/lib/speaker-tools";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Agreement | Momentum+ Admin" };

/*
 * Editing the Leadership Advisor Agreement before it goes to an Advisor
 * (Matt, 2026-08-11). Two modes:
 *
 *   /admin/agreement              the master everyone signs
 *   /admin/agreement?speaker=<id> one Advisor's tailored copy
 *
 * Super Admin only: this is the contract that makes somebody an Advisor,
 * not "content". A signed copy is never editable from here — advisor_
 * agreements is append-only and stores the hash of the words as signed, so
 * anything changed here reaches future signatures only.
 */
export default async function AdminAgreementPage(props: {
  searchParams?: Promise<{ speaker?: string }>;
}) {
  const searchParams = await props.searchParams;
  await requireMember();

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    redirect("/admin");
  }
  const access = await getAdminAccess();
  if (!access || access.role !== "super") redirect("/admin");

  const speakerId = searchParams?.speaker?.trim();

  if (speakerId) {
    const [speaker, published, override] = await Promise.all([
      getSpeakerById(speakerId),
      getPublishedAgreement(),
      getSpeakerOverride(speakerId),
    ]);
    if (!speaker) redirect("/admin/agreement");

    // Show the master with this Advisor's wording already swapped in, so the
    // admin edits what the Advisor will actually read.
    const doc = {
      ...published.doc,
      sections: published.doc.sections.map((s) => {
        const patch = override.overrides[String(s.n)];
        return patch
          ? { n: s.n, title: patch.title ?? s.title, blocks: patch.blocks ?? s.blocks }
          : s;
      }),
    };

    return (
      <>
        <div className="admin-pad">
          <Link className="btn-mini" href="/admin/agreement">
            Back to the master agreement
          </Link>
        </div>
        <AgreementEditor
          doc={doc}
          speaker={{ id: speaker.id, name: speaker.name }}
          overriddenSections={Object.keys(override.overrides).map(Number)}
          overrideNote={override.note}
        />
        <RequireResignatureCard
          affectedCount={1}
          speaker={{ id: speaker.id, name: speaker.name }}
        />
      </>
    );
  }

  const [published, draft] = await Promise.all([
    getPublishedAgreement(),
    getAgreementDraft(),
  ]);
  // Against what is in force — which is the shipped wording until something
  // is published, so the first draft's diff is still meaningful.
  const changes = draft ? diffAgreementDocs(published.doc, draft.doc) : [];
  const affectedCount = await countAdvisorsHoldingCurrentSignature(
    published.currency,
  );

  // Advisors who could be given a tailored copy: everyone the agreement
  // actually applies to (§1 — mainstage speakers are a different role).
  const { data: speakerRows } = await createServiceClient()
    .from("speakers")
    .select("id, name, tsls_main_speaker, advisor_agreement_waived")
    .is("archived_at", null)
    .order("name");
  const advisors = (speakerRows ?? []).filter(
    (s) => !s.tsls_main_speaker && !s.advisor_agreement_waived,
  );

  const { data: overrideRows } = await createServiceClient()
    .from("agreement_overrides")
    .select("speaker_id, sections, note");
  const overrideBySpeaker = new Map(
    (overrideRows ?? []).map((r) => [
      r.speaker_id as string,
      Object.keys((r.sections as Record<string, unknown>) ?? {}).length,
    ]),
  );

  return (
    <>
      <AgreementEditor
        doc={draft?.doc ?? published.doc}
        draftVersion={draft?.version ?? null}
        publishedVersion={published.fromDatabase ? published.currency.version : null}
        changes={changes}
      />

      <RequireResignatureCard affectedCount={affectedCount} />

      <div className="admin-pad">
        <div className="section-header">
          <div>
            <h2>Tailored copies</h2>
            <p>
              Give one Advisor different wording before their agreement goes
              out. Clauses you don&apos;t change keep following the master.
            </p>
          </div>
        </div>
        <div className="card">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <tbody>
                {advisors.length === 0 && (
                  <tr>
                    <td>
                      No Leadership Advisors yet — every speaker on file is a
                      TSLS Main Speaker or has the agreement waived.
                    </td>
                  </tr>
                )}
                {advisors.map((s) => {
                  const count = overrideBySpeaker.get(s.id as string) ?? 0;
                  return (
                    <tr key={s.id as string}>
                      <td>
                        <div className="admin-row-title">{s.name as string}</div>
                        <div className="cc-sub">
                          {count === 0
                            ? "Standard agreement"
                            : `${count} tailored ${count === 1 ? "clause" : "clauses"}`}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link
                          className="btn-mini"
                          href={`/admin/agreement?speaker=${s.id as string}`}
                        >
                          Edit their copy
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

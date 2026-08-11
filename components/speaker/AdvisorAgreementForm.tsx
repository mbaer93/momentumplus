"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signAdvisorAgreement } from "@/app/(portal)/speaker/agreement/actions";
import {
  AGREEMENT_ACCEPTANCE,
  AGREEMENT_PREAMBLE,
  AGREEMENT_SECTIONS,
  AGREEMENT_TITLE,
  type AgreementBlock,
} from "@/lib/advisor-agreement";

/*
 * The Leadership Advisor Agreement, on screen.
 *
 * The document's own wording comes straight from lib/advisor-agreement.ts and
 * is rendered as-is. The only text this component adds is form labels and
 * help — never a restatement of a clause. Where the UI needs a sentence about
 * what the agreement says, it quotes it (the acknowledgement is §34 verbatim).
 */

export interface AdvisorAgreementSpeaker {
  name: string;
  organization: string | null;
  featuredSessionDate: string | null;
  featuredSessionTime: string | null;
  /** "February 2027", or null when SLC hasn't assigned the month yet. */
  featuredMonthLabel: string | null;
}

export interface AdvisorAgreementSignature {
  signedName: string;
  /** Already formatted for display — this component does no date math. */
  signedAtLabel: string;
  agreementVersion: string;
  /** False when the signature is against superseded wording (§32). */
  current: boolean;
}

function Blocks({ blocks }: { blocks: AgreementBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "p":
            return (
              <p key={i} className="advisor-agreement-p">
                {block.text}
              </p>
            );
          case "strong":
            return (
              <p key={i} className="advisor-agreement-p strong">
                {block.text}
              </p>
            );
          case "sub":
            return (
              <h4 key={i} className="advisor-agreement-sub">
                {block.text}
              </h4>
            );
          case "ul":
            return (
              <ul key={i} className="advisor-agreement-ul">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
        }
      })}
    </>
  );
}

export function AdvisorAgreementForm({
  speaker,
  email,
  signature,
  readOnly = false,
  previewAs = null,
}: {
  speaker: AdvisorAgreementSpeaker;
  email: string;
  /** The speaker's latest signature, or null if they've never signed. */
  signature: AdvisorAgreementSignature | null;
  /** True when nobody can sign from this view (admin looking at a speaker). */
  readOnly?: boolean;
  /** Name of the speaker an admin is inspecting, if any. */
  previewAs?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const settled = signature?.current === true;

  function onSubmit(formData: FormData) {
    setMsg(null);
    start(async () => {
      const res = await signAdvisorAgreement(formData);
      setMsg({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="admin-pad advisor-agreement">
      <div className="section-header">
        <div>
          <h2>{AGREEMENT_TITLE}</h2>
          <p>Sierra Learnership Collaborative, LLC</p>
        </div>
      </div>

      {previewAs && (
        <div className="admin-hint">
          Viewing {previewAs}&apos;s agreement. Signing is disabled — only the
          Advisor can sign their own.
        </div>
      )}

      {settled && (
        <div className="admin-hint">
          Signed by {signature?.signedName} on {signature?.signedAtLabel}. Your
          Speaker Studio is open — this page is here whenever you want to read
          the agreement again.
        </div>
      )}

      {!settled && signature && (
        <div className="admin-hint">
          You signed an earlier version of this agreement on{" "}
          {signature.signedAtLabel}. The wording has been amended since, so it
          needs signing again before your Studio reopens.
        </div>
      )}

      {!settled && !signature && !readOnly && (
        <div className="admin-hint">
          Read the agreement below, fill in your details, and sign at the
          bottom. Speaker Studio opens as soon as you do.
        </div>
      )}

      <form action={onSubmit}>
        {/* ---- Parties: the blanks at the head of the document ---- */}
        <div className="admin-form" style={{ maxWidth: "none" }}>
          <p className="advisor-agreement-p">{AGREEMENT_PREAMBLE}</p>

          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="advisorName">Leadership Advisor</label>
              <input
                id="advisorName"
                name="advisorName"
                defaultValue={speaker.name}
                disabled={settled || readOnly}
                required
              />
            </div>
            <div className="admin-field">
              <label htmlFor="organization">Organization</label>
              <input
                id="organization"
                name="organization"
                defaultValue={speaker.organization ?? ""}
                disabled={settled || readOnly}
              />
            </div>
          </div>

          <div className="admin-field-row">
            <div className="admin-field">
              <label htmlFor="email">Email</label>
              {/* Read-only on purpose: this is the account signing, and it
                  is what the signature record is filed against. */}
              <input id="email" value={email} disabled readOnly />
            </div>
            <div className="admin-field">
              <label htmlFor="phone">Phone</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                defaultValue=""
                disabled={settled || readOnly}
              />
            </div>
          </div>

          <div className="admin-field">
            <label>Effective Date</label>
            <div className="advisor-agreement-readonly">
              The date you sign.
            </div>
          </div>
        </div>

        {/* ---- §1 and §2, with §2's blanks inline where they belong ---- */}
        {AGREEMENT_SECTIONS.filter((s) => s.n <= 2).map((section) => (
          <section key={section.n} className="admin-form" style={{ maxWidth: "none" }}>
            <h3 className="advisor-agreement-h">
              {section.n}. {section.title}
            </h3>
            {section.n === 2 ? (
              <>
                <Blocks blocks={section.blocks.slice(0, 1)} />
                <div className="admin-field">
                  <label>Featured Month</label>
                  <div className="advisor-agreement-readonly">
                    {speaker.featuredMonthLabel ??
                      "To be assigned by Sierra Learnership Collaborative."}
                  </div>
                </div>
                <div className="admin-field-row">
                  <div className="admin-field">
                    <label htmlFor="featuredSessionDate">
                      Anticipated Featured Session Date
                    </label>
                    <input
                      id="featuredSessionDate"
                      name="featuredSessionDate"
                      type="date"
                      defaultValue={speaker.featuredSessionDate ?? ""}
                      disabled={settled || readOnly}
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="featuredSessionTime">
                      Anticipated Featured Session Time
                    </label>
                    <input
                      id="featuredSessionTime"
                      name="featuredSessionTime"
                      placeholder="12:00 PM ET"
                      defaultValue={speaker.featuredSessionTime ?? ""}
                      disabled={settled || readOnly}
                    />
                  </div>
                </div>
                <Blocks blocks={section.blocks.slice(1)} />
              </>
            ) : (
              <Blocks blocks={section.blocks} />
            )}
          </section>
        ))}

        {/* ---- §3 onwards, straight through ---- */}
        <div className="admin-form" style={{ maxWidth: "none" }}>
          {AGREEMENT_SECTIONS.filter((s) => s.n > 2).map((section) => (
            <section key={section.n}>
              <h3 className="advisor-agreement-h">
                {section.n}. {section.title}
              </h3>
              <Blocks blocks={section.blocks} />
            </section>
          ))}
        </div>

        {/* ---- §34 Acceptance ---- */}
        <div className="admin-form" style={{ maxWidth: "none" }}>
          <h3 className="advisor-agreement-h">34. Acceptance</h3>
          <p className="advisor-agreement-p">{AGREEMENT_ACCEPTANCE}</p>

          <div className="admin-field">
            <label className="admin-check-row" htmlFor="accepted">
              <input
                id="accepted"
                name="accepted"
                type="checkbox"
                defaultChecked={settled}
                disabled={settled || readOnly}
              />
              <span>{AGREEMENT_ACCEPTANCE}</span>
            </label>
          </div>

          <div className="admin-field" style={{ maxWidth: 420 }}>
            <label htmlFor="signedName">Signature — type your full name</label>
            <input
              id="signedName"
              name="signedName"
              className="advisor-agreement-signature"
              defaultValue={settled ? (signature?.signedName ?? "") : ""}
              disabled={settled || readOnly}
              autoComplete="off"
              required
            />
          </div>

          <div className="advisor-agreement-countersign">
            <div className="advisor-agreement-countersign-name">
              Sierra W. Collins
            </div>
            <div>Founder &amp; CEO, Sierra Learnership Collaborative, LLC</div>
            <div>Signed 2026-08-10</div>
          </div>

          {msg && (
            <div className={`admin-form-msg ${msg.ok ? "ok" : "err"}`}>
              {msg.text}
            </div>
          )}

          {!settled && !readOnly && (
            <div className="admin-form-actions">
              <button className="btn-primary" type="submit" disabled={pending}>
                {pending ? "Signing…" : "Sign agreement"}
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

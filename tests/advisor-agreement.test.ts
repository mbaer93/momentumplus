import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AGREEMENT_ACCEPTANCE,
  AGREEMENT_SECTIONS,
  AGREEMENT_VERSION,
  agreementIsCurrent,
  agreementRequired,
  canonicalAgreementText,
  mustSignBeforeStudio,
  resolveAgreementDoc,
  DEFAULT_AGREEMENT_DOC,
  type AgreementDoc,
} from "../lib/advisor-agreement";

/*
 * The Leadership Advisor Agreement gate (Sierra's draft, 2026-08-10).
 *
 * Two things are being protected here: who is made to sign, and what the
 * hash in advisor_agreements is a hash OF. The first is access control; the
 * second is the only evidence of which wording someone agreed to.
 */

const ADVISOR = { tslsMainSpeaker: false, advisorAgreementWaived: false };
const MAIN_SPEAKER = { tslsMainSpeaker: true, advisorAgreementWaived: false };
const WAIVED = { tslsMainSpeaker: false, advisorAgreementWaived: true };

const signature = (version: string) => ({
  agreementVersion: version,
  signedName: "Robert Fulcher",
  signedAt: "2026-08-11T14:00:00Z",
});

test("only Leadership Advisors are asked to sign", () => {
  assert.equal(agreementRequired(ADVISOR), true);
  // §1: the Advisor role is explicitly not a mainstage speaker role, so this
  // agreement is not a TSLS Main Speaker's to sign.
  assert.equal(agreementRequired(MAIN_SPEAKER), false);
  // An admin waiver (signed on paper, or not an Advisor at all).
  assert.equal(agreementRequired(WAIVED), false);
  // A main speaker who is ALSO waived is still not asked — the two reasons
  // overlap without contradicting, the same way tsls_main_speaker and
  // payment_access do.
  assert.equal(
    agreementRequired({ tslsMainSpeaker: true, advisorAgreementWaived: true }),
    false,
  );
});

test("a signature is only current for the version it was made against", () => {
  assert.equal(agreementIsCurrent(signature(AGREEMENT_VERSION)), true);
  assert.equal(agreementIsCurrent(signature("2026-01-01")), false);
  assert.equal(agreementIsCurrent(null), false);
});

test("the Studio gate: unsigned Advisors are held, everyone else passes", () => {
  // The case the gate exists for.
  assert.equal(mustSignBeforeStudio(ADVISOR, null), true);
  // Signed the wording on file — straight through.
  assert.equal(mustSignBeforeStudio(ADVISOR, signature(AGREEMENT_VERSION)), false);
  // §32: the agreement was amended after they signed, so they sign again.
  assert.equal(mustSignBeforeStudio(ADVISOR, signature("2026-07-01")), true);
  // Nobody who isn't an Advisor is ever held at the gate, signed or not.
  assert.equal(mustSignBeforeStudio(MAIN_SPEAKER, null), false);
  assert.equal(mustSignBeforeStudio(WAIVED, null), false);
});

test("the canonical text covers every section, in order, once", () => {
  const text = canonicalAgreementText();
  // §§1–33 are data; §34 is appended by the serializer.
  assert.equal(AGREEMENT_SECTIONS.length, 33);
  assert.deepEqual(
    AGREEMENT_SECTIONS.map((s) => s.n),
    Array.from({ length: 33 }, (_, i) => i + 1),
  );
  for (const section of AGREEMENT_SECTIONS) {
    assert.ok(
      text.includes(`${section.n}. ${section.title}`),
      `§${section.n} ${section.title} is missing from the canonical text`,
    );
  }
  assert.ok(text.includes("34. Acceptance"));
  assert.ok(text.includes(AGREEMENT_ACCEPTANCE));
});

test("the canonical text carries the clauses the platform is built around", () => {
  const text = canonicalAgreementText();
  // §13: the 15% share and the prepaid-allocation rule lib/revenue.ts
  // implements. If either sentence ever leaves the document, the code that
  // pays people is no longer describing the contract.
  assert.match(text, /Fifteen percent \(15%\) of Momentum\+ membership revenue/);
  assert.match(text, /allocated across the applicable commitment period/);
  assert.match(text, /\$139 per active month/);
  // §14: two Advisors share one 15% allocation.
  assert.match(text, /the standard Advisor allocation remains 15% total/);
  // §15: the contract names this platform as the calculator of record.
  assert.match(text, /The Momentum\+ platform will calculate/);
  // §8: the member-solicitation limits.
  assert.match(text, /Download or export member lists for unrelated marketing/);
});

test("the hash tracks the wording, not the layout", () => {
  const sha = (text: string) =>
    createHash("sha256").update(text).digest("hex");

  // Stable across calls — the same document always hashes the same.
  assert.equal(sha(canonicalAgreementText()), sha(canonicalAgreementText()));

  // A changed word changes the hash. This is the property the signature
  // ledger leans on: agreement_sha256 identifies the text someone read, so
  // an edit can never pass for the version already signed.
  const edited = canonicalAgreementText().replace(
    "Fifteen percent (15%)",
    "Twenty percent (20%)",
  );
  assert.notEqual(sha(edited), sha(canonicalAgreementText()));

  // Moving a line between a paragraph and a bullet changes it too — the
  // serializer prefixes each line with its kind precisely so that a
  // restructure can't slip through as "the same text".
  const reshaped = canonicalAgreementText().replace("li:Harassment", "p:Harassment");
  assert.notEqual(sha(reshaped), sha(canonicalAgreementText()));
});

test("no section is empty, and bullet lists have items", () => {
  for (const section of AGREEMENT_SECTIONS) {
    assert.ok(
      section.title.trim().length > 0,
      `§${section.n} has no title`,
    );
    assert.ok(
      section.blocks.length > 0,
      `§${section.n} ${section.title} has no body`,
    );
    for (const block of section.blocks) {
      if (block.kind === "ul") {
        assert.ok(
          block.items.length > 0,
          `§${section.n} ${section.title} has an empty bullet list`,
        );
        for (const item of block.items) {
          assert.ok(item.trim().length > 0, `§${section.n} has an empty bullet`);
        }
      } else {
        assert.ok(
          block.text.trim().length > 0,
          `§${section.n} ${section.title} has an empty ${block.kind}`,
        );
      }
    }
  }
});

/*
 * Editing the agreement before it is sent (migration 0086).
 *
 * Matt, 2026-08-11: "I don't want a completed agreement to be editable, I
 * want to be able to edit the agreement before it is sent to the speaker."
 * The immutability of a SIGNED row is enforced in the database (0083's
 * trigger); what these pin is the wording an Advisor is measured against and
 * when an edit does — and does not — cost them a new signature.
 */

const signedAt = (iso: string) => ({
  agreementVersion: "2026-08-10",
  signedName: "Robert Fulcher",
  signedAt: iso,
});

test("overrides are sparse: untouched clauses keep following the master", () => {
  const master = DEFAULT_AGREEMENT_DOC;
  const resolved = resolveAgreementDoc(master, {
    "14": { blocks: [{ kind: "p", text: "A bespoke revenue share." }] },
  });

  const fourteen = resolved.sections.find((s) => s.n === 14)!;
  assert.deepEqual(fourteen.blocks, [
    { kind: "p", text: "A bespoke revenue share." },
  ]);
  // Its heading was not overridden, so it still comes from the master.
  assert.equal(fourteen.title, master.sections.find((s) => s.n === 14)!.title);

  // Every other clause is the master's, untouched.
  for (const section of resolved.sections) {
    if (section.n === 14) continue;
    assert.deepEqual(section, master.sections.find((s) => s.n === section.n));
  }
  // Structure is preserved: same clauses, same numbering.
  assert.equal(resolved.sections.length, master.sections.length);
});

test("an override cannot invent, delete, or renumber a clause", () => {
  const master = DEFAULT_AGREEMENT_DOC;
  // §99 does not exist; an override naming it must not append one — §6 and
  // §14 are referenced by number elsewhere in the app.
  const resolved = resolveAgreementDoc(master, {
    "99": { title: "Smuggled in", blocks: [{ kind: "p", text: "nope" }] },
  });
  assert.equal(resolved.sections.length, master.sections.length);
  assert.equal(resolved.sections.find((s) => s.n === 99), undefined);
  assert.deepEqual(
    resolved.sections.map((s) => s.n),
    master.sections.map((s) => s.n),
  );

  // No overrides at all is the master itself, not a copy of it.
  assert.equal(resolveAgreementDoc(master, {}), master);
  assert.equal(resolveAgreementDoc(master, null), master);
});

test("overridden wording changes the hash, so the record says what was signed", () => {
  const master = DEFAULT_AGREEMENT_DOC;
  const tailored = resolveAgreementDoc(master, {
    "14": { blocks: [{ kind: "p", text: "A bespoke revenue share." }] },
  });
  assert.notEqual(
    canonicalAgreementText(tailored),
    canonicalAgreementText(master),
  );
  // The default argument is still the shipped wording.
  assert.equal(canonicalAgreementText(), canonicalAgreementText(master));
});

test("a material amendment invalidates earlier signatures; a cosmetic one does not", () => {
  const amendedAt = "2026-09-01T00:00:00Z";
  const before = signedAt("2026-08-11T14:00:00Z");
  const after = signedAt("2026-09-02T09:00:00Z");

  // Material: signed before the amendment, so they sign again.
  const material = { version: "2026-09-01", materialChangedAt: amendedAt };
  assert.equal(agreementIsCurrent(before, material), false);
  assert.equal(agreementIsCurrent(after, material), true);
  assert.equal(mustSignBeforeStudio(ADVISOR, before, material), true);
  assert.equal(mustSignBeforeStudio(ADVISOR, after, material), false);

  // Cosmetic: a new version published with no material change. Both
  // signatures still stand even though neither names the new version.
  const cosmetic = { version: "2026-09-05", materialChangedAt: amendedAt };
  assert.equal(agreementIsCurrent(after, cosmetic), true);

  // Signing at the very moment of the amendment counts — the boundary is
  // inclusive, so a signature and an amendment in the same instant does not
  // send someone back to a document they just agreed to.
  assert.equal(agreementIsCurrent(signedAt(amendedAt), material), true);

  // Nobody who isn't an Advisor is held, whatever the wording did.
  assert.equal(mustSignBeforeStudio(MAIN_SPEAKER, before, material), false);
  assert.equal(mustSignBeforeStudio(WAIVED, null, material), false);
});

test("with no material change on record, currency falls back to the version", () => {
  // How a database with no template rows behaves — unchanged from pre-0086.
  const shipped = { version: AGREEMENT_VERSION, materialChangedAt: null };
  assert.equal(agreementIsCurrent(signature(AGREEMENT_VERSION), shipped), true);
  assert.equal(agreementIsCurrent(signature("2026-01-01"), shipped), false);
  assert.equal(agreementIsCurrent(null, shipped), false);
});

test("a rewording round-trips through the doc shape without losing structure", () => {
  const master = DEFAULT_AGREEMENT_DOC;
  // What the editor does: same shape, new text.
  const reworded: AgreementDoc = {
    ...master,
    sections: master.sections.map((s) => ({
      n: s.n,
      title: s.title,
      blocks: s.blocks.map((b) =>
        b.kind === "ul"
          ? { kind: "ul" as const, items: b.items.map((i) => `${i}.`) }
          : { kind: b.kind, text: `${b.text}` },
      ),
    })),
  };
  assert.equal(reworded.sections.length, master.sections.length);
  assert.deepEqual(
    reworded.sections.map((s) => s.n),
    master.sections.map((s) => s.n),
  );
  // Bullet lists stay lists — a rewrite must not flatten one into a
  // paragraph, which the hash would treat as a different agreement.
  for (const [i, section] of reworded.sections.entries()) {
    assert.deepEqual(
      section.blocks.map((b) => b.kind),
      master.sections[i].blocks.map((b) => b.kind),
    );
  }
});

/*
 * A completed agreement is locked — no edits, by anybody (Matt, 2026-08-12).
 *
 * The signature was already safe: advisor_agreements is append-only and
 * stores the hash of the words as rendered at signing, so no later edit can
 * rewrite what somebody agreed to. What an edit COULD still do is change the
 * copy their agreement resolves to from here on — a different document
 * wearing their signature. agreementIsCurrent is the predicate the save path
 * refuses on, so these pin its two directions.
 */
test("a current signature is what locks an Advisor's copy", () => {
  const currency = { version: "2026-08-10", materialChangedAt: null };

  // Signed the wording in force → locked.
  assert.equal(agreementIsCurrent(signature("2026-08-10"), currency), true);

  // Never signed → not locked, which is the whole point of a pre-send editor.
  assert.equal(agreementIsCurrent(null, currency), false);

  // Signed an older version → not locked: they are already being asked to
  // sign again, so their copy is still in play.
  assert.equal(agreementIsCurrent(signature("2026-07-01"), currency), false);
});

test("asking them to sign again is what unlocks it", () => {
  const signedOn = "2026-08-11T14:00:00Z";
  const signed = {
    agreementVersion: "2026-08-10",
    signedName: "Robert Fulcher",
    signedAt: signedOn,
  };

  // Locked while their signature stands.
  assert.equal(
    agreementIsCurrent(signed, { version: "2026-08-10", materialChangedAt: null }),
    true,
  );

  // A material amendment recorded AFTER they signed drops their signature out
  // of currency — the copy becomes editable again, and they are asked to
  // agree to the new terms. That is the only route back to an unlocked copy.
  assert.equal(
    agreementIsCurrent(signed, {
      version: "2026-08-10",
      materialChangedAt: "2026-08-12T00:00:00Z",
    }),
    false,
  );
});

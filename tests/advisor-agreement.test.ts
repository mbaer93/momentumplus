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

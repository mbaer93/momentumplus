import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blocksToText,
  describeChanges,
  diffAgreementDocs,
} from "../lib/agreement-diff";
import { DEFAULT_AGREEMENT_DOC, type AgreementDoc } from "../lib/advisor-agreement";

/*
 * The diff an admin reads before publishing legal wording (Matt, 2026-08-11:
 * show a diff against the published text before publishing).
 *
 * What these protect: that a change can't reach the publish button without
 * being shown, and that an unchanged draft is reported as unchanged — the
 * publish button is disabled on an empty diff, so a false "no changes" would
 * block a real amendment and a false change would invite a pointless version.
 */

const withSection = (n: number, patch: Partial<{ title: string; text: string }>): AgreementDoc => ({
  ...DEFAULT_AGREEMENT_DOC,
  sections: DEFAULT_AGREEMENT_DOC.sections.map((s) =>
    s.n === n
      ? {
          n: s.n,
          title: patch.title ?? s.title,
          blocks: patch.text ? [{ kind: "p" as const, text: patch.text }] : s.blocks,
        }
      : s,
  ),
});

test("an identical document reports no changes", () => {
  assert.deepEqual(diffAgreementDocs(DEFAULT_AGREEMENT_DOC, DEFAULT_AGREEMENT_DOC), []);
  // Same content, different object identity — must still be empty.
  const copy: AgreementDoc = JSON.parse(JSON.stringify(DEFAULT_AGREEMENT_DOC));
  assert.deepEqual(diffAgreementDocs(DEFAULT_AGREEMENT_DOC, copy), []);
  assert.equal(describeChanges([]), "No changes");
});

test("a reworded clause is reported with both versions in full", () => {
  const after = withSection(14, { text: "A bespoke revenue share." });
  const changes = diffAgreementDocs(DEFAULT_AGREEMENT_DOC, after);

  assert.equal(changes.length, 1);
  const [c] = changes;
  assert.equal(c.kind, "section");
  assert.equal(c.n, 14);
  assert.ok(c.label.startsWith("§14 "));
  assert.equal(c.after, "A bespoke revenue share.");
  // The whole previous clause, not a fragment — that is the unit somebody
  // has to agree to.
  assert.equal(
    c.before,
    blocksToText(DEFAULT_AGREEMENT_DOC.sections.find((s) => s.n === 14)!.blocks),
  );
  assert.notEqual(c.before, c.after);
});

test("a heading-only change is still a change", () => {
  const after = withSection(14, { title: "Revenue Share (amended)" });
  const changes = diffAgreementDocs(DEFAULT_AGREEMENT_DOC, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].headingChanged, true);
  // Body unchanged, so both sides read the same — the heading flag is what
  // tells the reader why it is listed.
  assert.equal(changes[0].before, changes[0].after);
});

test("title, preamble and acceptance changes are each reported", () => {
  const changes = diffAgreementDocs(DEFAULT_AGREEMENT_DOC, {
    ...DEFAULT_AGREEMENT_DOC,
    title: "A different title",
    preamble: "A different preamble.",
    acceptance: "A different acceptance.",
  });
  assert.deepEqual(
    changes.map((c) => c.kind),
    ["title", "preamble", "acceptance"],
  );
});

test("changes come back in document order", () => {
  const after: AgreementDoc = {
    ...DEFAULT_AGREEMENT_DOC,
    preamble: "Changed.",
    sections: DEFAULT_AGREEMENT_DOC.sections.map((s) =>
      s.n === 6 || s.n === 21
        ? { n: s.n, title: s.title, blocks: [{ kind: "p" as const, text: `${s.n} changed` }] }
        : s,
    ),
    acceptance: "Changed too.",
  };
  const changes = diffAgreementDocs(DEFAULT_AGREEMENT_DOC, after);
  assert.deepEqual(
    changes.map((c) => c.kind === "section" ? `§${c.n}` : c.kind),
    ["preamble", "§6", "§21", "acceptance"],
  );
  assert.equal(describeChanges(changes), "2 clauses and 2 other parts changed");
});

test("bullet lists survive the flattening as bullets", () => {
  const withList = DEFAULT_AGREEMENT_DOC.sections.find((s) =>
    s.blocks.some((b) => b.kind === "ul"),
  );
  assert.ok(withList, "the shipped agreement has a list to test with");
  const text = blocksToText(withList.blocks);
  assert.ok(text.includes("• "), "list items render as bullets, not one run-on line");
});

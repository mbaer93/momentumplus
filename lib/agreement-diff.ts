import type { AgreementBlock, AgreementDoc } from "@/lib/advisor-agreement";

/*
 * What changed between two versions of the Leadership Advisor Agreement.
 *
 * This is legal wording and §32 requires both parties to agree to a material
 * amendment, so an admin must be able to see exactly which clauses moved
 * before they publish — "trust me, it's just a typo" is not a review.
 *
 * Section-level, not word-level, and deliberately so: a word-diff of a
 * contract invites skimming the highlights and missing the sentence around
 * them. The whole clause is shown before and after, which is the unit a
 * person actually has to agree to.
 *
 * Pure — no database, no rendering — so the comparison is testable on its
 * own and the publish screen can't disagree with what gets stored.
 */

/** One clause's text, flattened for comparison and display. */
export function blocksToText(blocks: AgreementBlock[]): string {
  return blocks
    .map((b) =>
      b.kind === "ul" ? b.items.map((i) => `• ${i}`).join("\n") : b.text,
    )
    .join("\n\n");
}

export type AgreementChangeKind =
  | "title"
  | "preamble"
  | "acceptance"
  | "section";

export interface AgreementChange {
  kind: AgreementChangeKind;
  /** Section number, for kind === "section". */
  n?: number;
  /** What to call this in the UI: "§14 Revenue Share", "Preamble". */
  label: string;
  before: string;
  after: string;
  /** True when the clause's heading changed, not just its body. */
  headingChanged?: boolean;
}

/**
 * Every difference between `before` and `after`, in document order.
 *
 * An empty result means the two documents say exactly the same thing, which
 * is the signal the publish screen uses to stop an admin publishing a
 * version that changes nothing (a new version number on identical wording
 * makes the ledger harder to read, not safer).
 *
 * Sections are compared by NUMBER, not position: this editor cannot add,
 * remove or renumber clauses, so a §14 always lines up with a §14, and a
 * number appearing on only one side is reported rather than silently
 * dropped — that would mean something upstream broke the invariant.
 */
export function diffAgreementDocs(
  before: AgreementDoc,
  after: AgreementDoc,
): AgreementChange[] {
  const changes: AgreementChange[] = [];

  if (before.title !== after.title) {
    changes.push({
      kind: "title",
      label: "Title",
      before: before.title,
      after: after.title,
    });
  }
  if (before.preamble !== after.preamble) {
    changes.push({
      kind: "preamble",
      label: "Preamble",
      before: before.preamble,
      after: after.preamble,
    });
  }

  const beforeByN = new Map(before.sections.map((s) => [s.n, s]));
  const afterByN = new Map(after.sections.map((s) => [s.n, s]));
  const numbers = [...new Set([...beforeByN.keys(), ...afterByN.keys()])].sort(
    (a, b) => a - b,
  );

  for (const n of numbers) {
    const b = beforeByN.get(n);
    const a = afterByN.get(n);
    const bText = b ? blocksToText(b.blocks) : "";
    const aText = a ? blocksToText(a.blocks) : "";
    const headingChanged = (b?.title ?? "") !== (a?.title ?? "");
    if (bText === aText && !headingChanged) continue;
    changes.push({
      kind: "section",
      n,
      // The heading shown is the one being moved TO, since that is what the
      // agreement will say once this is published.
      label: `§${n} ${a?.title ?? b?.title ?? ""}`.trim(),
      before: bText,
      after: aText,
      headingChanged,
    });
  }

  if (before.acceptance !== after.acceptance) {
    changes.push({
      kind: "acceptance",
      label: "§34 Acceptance",
      before: before.acceptance,
      after: after.acceptance,
    });
  }

  return changes;
}

/** A one-line summary for the confirm step: "3 clauses changed". */
export function describeChanges(changes: AgreementChange[]): string {
  if (changes.length === 0) return "No changes";
  const sections = changes.filter((c) => c.kind === "section").length;
  const other = changes.length - sections;
  const parts: string[] = [];
  if (sections > 0) {
    parts.push(`${sections} ${sections === 1 ? "clause" : "clauses"}`);
  }
  if (other > 0) parts.push(`${other} other ${other === 1 ? "part" : "parts"}`);
  return `${parts.join(" and ")} changed`;
}

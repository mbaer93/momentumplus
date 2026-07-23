import type { SessionCategory } from "@/lib/types";

/*
 * Program behavior flags (Sierra, 2026-07-22): Rooted Focus (and later the
 * monthly Aspire2Achieve sessions) are DROP-IN — no enrollment, any active
 * member can walk into the live room during the join window, calendar links
 * carry the Zoom URL, and the meetings are not recorded.
 */

const DROP_IN_PROGRAMS = new Set(["rooted_focus", "aspire"]);

export function isDropInProgram(program: string): boolean {
  return DROP_IN_PROGRAMS.has(program);
}

/** Drop-in co-working is never recorded; standard sessions feed the Library. */
export function programRecords(program: string): boolean {
  return !DROP_IN_PROGRAMS.has(program);
}

/** Rooted Focus displays as a Productivity Session and Aspire2Achieve as an
    Accountability Session regardless of the stored category (older rows
    were created as "Business"/"Networking"). */
export function displayCategory(session: {
  program: string;
  category: SessionCategory | string;
}): string {
  if (session.program === "rooted_focus") return "Productivity Session";
  if (session.program === "aspire") return "Accountability Session";
  return session.category;
}

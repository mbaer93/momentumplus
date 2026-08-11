import {
  DEFAULT_AGREEMENT_DOC,
  DEFAULT_CURRENCY,
  resolveAgreementDoc,
  type AgreementBlock,
  type AgreementCurrency,
  type AgreementDoc,
  type AgreementOverrides,
  type AgreementSection,
} from "@/lib/advisor-agreement";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Reading and writing the editable Leadership Advisor Agreement
 * (migration 0086).
 *
 * Everything here degrades to the shipped wording. A database that has not
 * run 0086 — or simply has no template rows yet — returns
 * DEFAULT_AGREEMENT_DOC and DEFAULT_CURRENCY, which is exactly how the app
 * behaved before the agreement became editable. That is deliberate: the
 * agreement gate must never fail open or blank because a table is missing.
 */

function configured(): boolean {
  return isSupabaseConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/* -------------------------------------------------------------------------
 * Parsing — never trust jsonb to still match the type that wrote it
 * ---------------------------------------------------------------------- */

function parseBlocks(raw: unknown): AgreementBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: AgreementBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const kind = (b as { kind?: unknown }).kind;
    if (kind === "ul") {
      const items = (b as { items?: unknown }).items;
      blocks.push({
        kind: "ul",
        items: Array.isArray(items)
          ? items.filter((i): i is string => typeof i === "string")
          : [],
      });
    } else if (kind === "p" || kind === "strong" || kind === "sub") {
      const text = (b as { text?: unknown }).text;
      blocks.push({ kind, text: typeof text === "string" ? text : "" });
    }
  }
  return blocks;
}

function parseSections(raw: unknown): AgreementSection[] {
  if (!Array.isArray(raw)) return [];
  const sections: AgreementSection[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const n = Number((s as { n?: unknown }).n);
    if (!Number.isFinite(n)) continue;
    const title = (s as { title?: unknown }).title;
    sections.push({
      n,
      title: typeof title === "string" ? title : "",
      blocks: parseBlocks((s as { blocks?: unknown }).blocks),
    });
  }
  return sections.sort((a, b) => a.n - b.n);
}

function rowToDoc(row: Record<string, unknown>): AgreementDoc {
  const sections = parseSections(row.sections);
  return {
    title: (row.title as string) || DEFAULT_AGREEMENT_DOC.title,
    preamble: (row.preamble as string) || DEFAULT_AGREEMENT_DOC.preamble,
    acceptance: (row.acceptance as string) || DEFAULT_AGREEMENT_DOC.acceptance,
    // A template row with no sections is corrupt, not "an empty agreement" —
    // fall back rather than present somebody a contract with no terms.
    sections: sections.length > 0 ? sections : DEFAULT_AGREEMENT_DOC.sections,
  };
}

export function parseOverrides(raw: unknown): AgreementOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AgreementOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const title = (value as { title?: unknown }).title;
    const blocks = (value as { blocks?: unknown }).blocks;
    const patch: { title?: string; blocks?: AgreementBlock[] } = {};
    if (typeof title === "string") patch.title = title;
    if (Array.isArray(blocks)) patch.blocks = parseBlocks(blocks);
    if (patch.title !== undefined || patch.blocks !== undefined) {
      out[key] = patch;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
 * The master document
 * ---------------------------------------------------------------------- */

export interface PublishedAgreement {
  doc: AgreementDoc;
  currency: AgreementCurrency;
  /** False when this is the shipped wording rather than a published row. */
  fromDatabase: boolean;
}

export const SHIPPED_AGREEMENT: PublishedAgreement = {
  doc: DEFAULT_AGREEMENT_DOC,
  currency: DEFAULT_CURRENCY,
  fromDatabase: false,
};

/** The master wording currently in force: newest published row, else shipped. */
export async function getPublishedAgreement(): Promise<PublishedAgreement> {
  if (!configured()) return SHIPPED_AGREEMENT;
  const { data, error } = await createServiceClient()
    .from("agreement_templates")
    .select("version, title, preamble, acceptance, sections, material_changed_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // error = migration 0086 hasn't run. The shipped wording is the honest
  // answer on a database with no template table.
  if (error || !data) return SHIPPED_AGREEMENT;

  // The material-change stamp that matters is the most recent one across
  // every published version, not just the newest — publishing a cosmetic fix
  // after a material amendment must not un-invalidate the older signatures
  // that amendment invalidated.
  const { data: lastMaterial } = await createServiceClient()
    .from("agreement_templates")
    .select("material_changed_at")
    .eq("status", "published")
    .not("material_changed_at", "is", null)
    .order("material_changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    doc: rowToDoc(data as Record<string, unknown>),
    currency: {
      version: (data.version as string) ?? DEFAULT_CURRENCY.version,
      materialChangedAt:
        (lastMaterial?.material_changed_at as string | null) ?? null,
    },
    fromDatabase: true,
  };
}

export interface AgreementDraft {
  id: string;
  version: string;
  doc: AgreementDoc;
}

/** The in-flight draft, or null when nobody is editing. */
export async function getAgreementDraft(): Promise<AgreementDraft | null> {
  if (!configured()) return null;
  const { data, error } = await createServiceClient()
    .from("agreement_templates")
    .select("id, version, title, preamble, acceptance, sections")
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id as string,
    version: data.version as string,
    doc: rowToDoc(data as Record<string, unknown>),
  };
}

/* -------------------------------------------------------------------------
 * Per-speaker overrides
 * ---------------------------------------------------------------------- */

export interface SpeakerOverride {
  overrides: AgreementOverrides;
  note: string;
  materialChangedAt: string | null;
}

export const NO_OVERRIDE: SpeakerOverride = {
  overrides: {},
  note: "",
  materialChangedAt: null,
};

export async function getSpeakerOverride(
  speakerId: string,
): Promise<SpeakerOverride> {
  if (!configured()) return NO_OVERRIDE;
  const { data, error } = await createServiceClient()
    .from("agreement_overrides")
    .select("sections, note, material_changed_at")
    .eq("speaker_id", speakerId)
    .maybeSingle();
  if (error || !data) return NO_OVERRIDE;
  return {
    overrides: parseOverrides(data.sections),
    note: (data.note as string | null) ?? "",
    materialChangedAt: (data.material_changed_at as string | null) ?? null,
  };
}

/* -------------------------------------------------------------------------
 * What one Advisor is actually asked to sign
 * ---------------------------------------------------------------------- */

export interface AgreementForSpeaker {
  doc: AgreementDoc;
  currency: AgreementCurrency;
  /** True when this Advisor's copy differs from the master. */
  hasOverrides: boolean;
}

/**
 * The master with this speaker's overrides applied, and the currency that
 * governs their signature.
 *
 * The effective material-change moment is the LATER of the master's and this
 * speaker's: rewriting one Advisor's §14 has to invalidate that Advisor's
 * signature even when the master hasn't moved, and a material master
 * amendment has to reach an overridden Advisor even when their own override
 * is older.
 */
export async function getAgreementForSpeaker(
  speakerId: string,
): Promise<AgreementForSpeaker> {
  const [master, override] = await Promise.all([
    getPublishedAgreement(),
    getSpeakerOverride(speakerId),
  ]);
  const hasOverrides = Object.keys(override.overrides).length > 0;
  const stamps = [master.currency.materialChangedAt, override.materialChangedAt]
    .filter((s): s is string => Boolean(s))
    .sort();
  return {
    doc: resolveAgreementDoc(master.doc, override.overrides),
    currency: {
      version: master.currency.version,
      materialChangedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
    },
    hasOverrides,
  };
}

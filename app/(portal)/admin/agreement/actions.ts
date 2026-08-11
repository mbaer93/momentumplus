"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  canonicalAgreementText,
  type AgreementBlock,
  type AgreementDoc,
  type AgreementOverrides,
  type AgreementSection,
} from "@/lib/advisor-agreement";
import {
  getAgreementDraft,
  getPublishedAgreement,
  getSpeakerOverride,
} from "@/lib/agreement-doc-db";
import { getAdminAccess } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Editing the Leadership Advisor Agreement (migration 0086).
 *
 * SUPER ADMIN ONLY. This is the contract that makes somebody a Leadership
 * Advisor; it is not "content" in the sense the area permissions mean.
 *
 * REWORDING ONLY, BY CONSTRUCTION. The document's SHAPE always comes from
 * the base document on the server — the section list, each section's block
 * kinds, and the number of bullets in a list. The form only supplies TEXT,
 * keyed by section number and block index. A caller cannot add a clause,
 * delete one, or renumber the agreement by posting a different form, which
 * is what keeps §6 and §14 meaning what the rest of the app says they mean.
 */

export interface EditorResult {
  ok: boolean;
  message: string;
}

const MAX_TEXT = 20_000;

function clean(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : "";
}

async function requireSuperAdmin(): Promise<string | null> {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const access = await getAdminAccess();
  if (!access || access.role !== "super") return null;
  const user = await getAuthUser();
  return user?.id ?? null;
}

/**
 * Rebuild a document from `base`'s structure and the form's text. Any field
 * the form omits keeps the base wording, so a partial post cannot blank a
 * clause.
 */
function docFromForm(base: AgreementDoc, form: FormData): AgreementDoc {
  const readBlocks = (
    section: AgreementSection,
  ): AgreementBlock[] =>
    section.blocks.map((block, i) => {
      const key = `s${section.n}.b${i}`;
      const raw = form.get(key);
      if (raw === null) return block;
      const value = clean(raw);
      if (block.kind === "ul") {
        const items = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        // An empty list would silently delete every bullet in the clause;
        // treat that as "no edit" rather than as a deletion.
        return items.length > 0 ? { kind: "ul", items } : block;
      }
      return { kind: block.kind, text: value || block.text };
    });

  return {
    title: clean(form.get("title")) || base.title,
    preamble: clean(form.get("preamble")) || base.preamble,
    acceptance: clean(form.get("acceptance")) || base.acceptance,
    sections: base.sections.map((section) => ({
      n: section.n,
      title: clean(form.get(`s${section.n}.title`)) || section.title,
      blocks: readBlocks(section),
    })),
  };
}

function hashDoc(doc: AgreementDoc): string {
  return createHash("sha256").update(canonicalAgreementText(doc)).digest("hex");
}

/* -------------------------------------------------------------------------
 * The master document
 * ---------------------------------------------------------------------- */

export async function saveAgreementDraft(
  formData: FormData,
): Promise<EditorResult> {
  const adminId = await requireSuperAdmin();
  if (!adminId) return { ok: false, message: "Super Admins only." };

  const [draft, published] = await Promise.all([
    getAgreementDraft(),
    getPublishedAgreement(),
  ]);
  // Edit on top of the draft if one is open, otherwise start from what is
  // in force — never from the shipped constants once a version is live.
  const base = draft?.doc ?? published.doc;
  const doc = docFromForm(base, formData);
  const version = clean(formData.get("version")) || draft?.version || "";
  if (!version) {
    return { ok: false, message: "Give this version a name (e.g. 2026-09-01)." };
  }

  const admin = createServiceClient();
  const row = {
    version,
    title: doc.title,
    preamble: doc.preamble,
    acceptance: doc.acceptance,
    sections: doc.sections,
    sha256: hashDoc(doc),
    status: "draft",
    created_by: adminId,
  };

  const { error } = draft
    ? await admin.from("agreement_templates").update(row).eq("id", draft.id)
    : await admin.from("agreement_templates").insert(row);

  if (error) {
    return {
      ok: false,
      message:
        error.code === "23505"
          ? "That version name is already used by a published version. Pick another."
          : "Couldn't save the draft. The agreement tables may not be set up yet.",
    };
  }
  revalidatePath("/admin/agreement");
  return { ok: true, message: "Draft saved. Nobody sees it until you publish." };
}

export async function publishAgreementDraft(
  formData: FormData,
): Promise<EditorResult> {
  const adminId = await requireSuperAdmin();
  if (!adminId) return { ok: false, message: "Super Admins only." };

  const draft = await getAgreementDraft();
  if (!draft) return { ok: false, message: "There's no draft to publish." };

  /*
   * §32: a MATERIAL amendment needs both parties to agree, so publishing one
   * invalidates every signature older than this moment and those Advisors are
   * asked to sign again. A cosmetic fix leaves signatures alone. The platform
   * cannot tell the two apart — the admin says which it is.
   */
  const material = formData.get("requiresResignature") === "on";
  const now = new Date().toISOString();

  const { error } = await createServiceClient()
    .from("agreement_templates")
    .update({
      status: "published",
      published_at: now,
      requires_resignature: material,
      material_changed_at: material ? now : null,
    })
    .eq("id", draft.id);

  if (error) return { ok: false, message: "Couldn't publish that draft." };

  revalidatePath("/admin/agreement");
  revalidatePath("/speaker/agreement");
  revalidatePath("/speaker");
  return {
    ok: true,
    message: material
      ? `Published "${draft.version}". Advisors who signed earlier will be asked to sign again.`
      : `Published "${draft.version}" as a cosmetic change. Existing signatures still stand.`,
  };
}

export async function discardAgreementDraft(): Promise<EditorResult> {
  const adminId = await requireSuperAdmin();
  if (!adminId) return { ok: false, message: "Super Admins only." };

  const draft = await getAgreementDraft();
  if (!draft) return { ok: false, message: "There's no draft to discard." };

  const { error } = await createServiceClient()
    .from("agreement_templates")
    .delete()
    .eq("id", draft.id);
  if (error) return { ok: false, message: "Couldn't discard the draft." };

  revalidatePath("/admin/agreement");
  return { ok: true, message: "Draft discarded." };
}

/* -------------------------------------------------------------------------
 * Per-speaker overrides
 * ---------------------------------------------------------------------- */

export async function saveSpeakerOverride(
  formData: FormData,
): Promise<EditorResult> {
  const adminId = await requireSuperAdmin();
  if (!adminId) return { ok: false, message: "Super Admins only." };

  const speakerId = clean(formData.get("speakerId"));
  if (!speakerId) return { ok: false, message: "No speaker given." };

  const [published, existing] = await Promise.all([
    getPublishedAgreement(),
    getSpeakerOverride(speakerId),
  ]);
  const edited = docFromForm(published.doc, formData);

  /*
   * Store only what actually differs from the master. A sparse override is
   * what lets a later master edit still reach this Advisor everywhere they
   * have not been given bespoke wording — storing the whole document would
   * quietly freeze them on today's text forever.
   */
  const overrides: AgreementOverrides = {};
  for (const section of edited.sections) {
    const master = published.doc.sections.find((s) => s.n === section.n);
    if (!master) continue;
    const titleChanged = section.title !== master.title;
    const blocksChanged =
      JSON.stringify(section.blocks) !== JSON.stringify(master.blocks);
    if (titleChanged || blocksChanged) {
      overrides[String(section.n)] = {
        ...(titleChanged ? { title: section.title } : {}),
        ...(blocksChanged ? { blocks: section.blocks } : {}),
      };
    }
  }

  const material = formData.get("requiresResignature") === "on";
  const note = clean(formData.get("note"));
  const now = new Date().toISOString();

  const { error } = await createServiceClient()
    .from("agreement_overrides")
    .upsert(
      {
        speaker_id: speakerId,
        sections: overrides,
        note,
        // Keep the previous stamp unless this edit is itself material —
        // a later cosmetic tweak must not un-invalidate what a material one
        // already invalidated.
        material_changed_at: material ? now : existing.materialChangedAt,
        updated_by: adminId,
      },
      { onConflict: "speaker_id" },
    );

  if (error) {
    return {
      ok: false,
      message: "Couldn't save. The agreement tables may not be set up yet.",
    };
  }

  revalidatePath("/admin/agreement");
  revalidatePath("/speaker/agreement");
  const count = Object.keys(overrides).length;
  return {
    ok: true,
    message:
      count === 0
        ? "Saved — this Advisor is back on the standard agreement."
        : `Saved ${count} tailored ${count === 1 ? "clause" : "clauses"}.${
            material ? " They'll be asked to sign again." : ""
          }`,
  };
}

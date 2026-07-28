"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface TopicResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

const PREVIEW: TopicResult = {
  ok: true,
  preview: true,
  message: "Saved (preview mode — no database configured).",
};

function bust() {
  revalidatePath("/library");
  revalidatePath("/admin/topics");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function guard() {
  const auth = await requireAdmin("content");
  return auth.ok ? null : auth.message;
}

export async function createTopic(
  name: string,
  sortOrder: string,
): Promise<TopicResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };

  const clean = name.trim();
  if (!clean) return { ok: false, message: "The category needs a name." };
  const sort = Number.parseInt(sortOrder, 10);

  const { error } = await createServiceClient().from("content_topics").insert({
    name: clean,
    slug: slugify(clean),
    sort: Number.isFinite(sort) ? sort : 100,
  });
  if (error) {
    return {
      ok: false,
      message: /duplicate|unique/i.test(error.message)
        ? "There's already a category with that name."
        : error.message,
    };
  }
  bust();
  return { ok: true, message: `"${clean}" added.` };
}

export async function renameTopic(
  id: string,
  name: string,
  sortOrder: string,
): Promise<TopicResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };

  const clean = name.trim();
  if (!clean) return { ok: false, message: "The category needs a name." };
  const sort = Number.parseInt(sortOrder, 10);

  // The slug is deliberately NOT regenerated: it is what the Library filter
  // links point at, and renaming a category shouldn't break a shared URL.
  const { error } = await createServiceClient()
    .from("content_topics")
    .update({ name: clean, sort: Number.isFinite(sort) ? sort : 100 })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Saved." };
}

/**
 * Archive rather than delete: recordings point at this row, and a hard delete
 * would silently strip their category. Archived topics leave every list but
 * existing assignments stay intact if it's ever restored.
 */
export async function archiveTopic(id: string): Promise<TopicResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };

  const { error } = await createServiceClient()
    .from("content_topics")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  bust();
  return { ok: true, message: "Category archived." };
}

/**
 * Set one item's whole topic list in a single call.
 *
 * Replace-all rather than add/remove: the editor sends the state it wants,
 * which keeps the "exactly one primary" index from tripping over an
 * intermediate state where two rows are briefly primary.
 */
export async function setTopics(
  kind: "video" | "session",
  itemId: string,
  primaryId: string | null,
  secondaryIds: string[],
): Promise<TopicResult> {
  if (!isSupabaseConfigured()) return PREVIEW;
  const denied = await guard();
  if (denied) return { ok: false, message: denied };

  const table = kind === "video" ? "video_topics" : "session_topics";
  const column = kind === "video" ? "video_id" : "session_id";
  const db = createServiceClient();

  const { error: clearErr } = await db.from(table).delete().eq(column, itemId);
  if (clearErr) return { ok: false, message: clearErr.message };

  // A topic can't be both; primary wins.
  const secondaries = secondaryIds.filter((id) => id && id !== primaryId);
  const rows = [
    ...(primaryId ? [{ [column]: itemId, topic_id: primaryId, is_primary: true }] : []),
    ...secondaries.map((id) => ({ [column]: itemId, topic_id: id, is_primary: false })),
  ];
  if (rows.length) {
    const { error } = await db.from(table).insert(rows);
    if (error) return { ok: false, message: error.message };
  }
  bust();
  return { ok: true, message: "Categories saved." };
}

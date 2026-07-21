import { createServiceClient } from "@/lib/supabase/admin";
import type { SessionResource } from "@/lib/types";

/*
 * Shared server-side helpers for per-session resources (migration 0047).
 * AUTHORIZATION IS THE CALLER'S JOB — the admin actions check
 * requireAdmin("sessions"), the speaker actions check speakerOwnsSession —
 * these helpers only do the data work, via the service role.
 */

/** Files a resource can be: documents members open during/after a session. */
const FILE_TYPES: Record<string, { ext: string; label: string }> = {
  "application/pdf": { ext: "pdf", label: "PDF" },
  "image/png": { ext: "png", label: "Image" },
  "image/jpeg": { ext: "jpg", label: "Image" },
  "video/mp4": { ext: "mp4", label: "Video" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    ext: "docx",
    label: "Document",
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    ext: "pptx",
    label: "Slides",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    ext: "xlsx",
    label: "Spreadsheet",
  },
};

const BUCKET = "resource-images"; // existing public bucket (speaker shares live here too)

export interface ResourceResult {
  ok: boolean;
  message?: string;
}

export async function listSessionResources(
  sessionId: string,
): Promise<SessionResource[]> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("session_resources")
    .select("id, name, type, url")
    .eq("session_id", sessionId)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    type: (r.type as string | null) ?? "Resource",
    url: r.url as string,
  }));
}

/**
 * Add a resource from a form: `name` plus EITHER `url` or an uploaded
 * `file`. Uploaded files land in public storage; the stored row points at
 * the public URL either way.
 */
export async function addSessionResourceFromForm(
  sessionId: string,
  formData: FormData,
): Promise<ResourceResult> {
  const name = String(formData.get("name") ?? "").trim();
  const linkUrl = String(formData.get("url") ?? "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!name) return { ok: false, message: "Give the resource a name." };
  if (!hasFile && !linkUrl) {
    return { ok: false, message: "Paste a link or attach a file." };
  }

  const admin = createServiceClient();
  let url = linkUrl;
  let typeLabel = "Link";

  if (hasFile) {
    if (file.size > 25 * 1024 * 1024) {
      return {
        ok: false,
        message:
          "Files are limited to 25 MB — host bigger videos elsewhere and paste the link instead.",
      };
    }
    const kind = FILE_TYPES[file.type];
    if (!kind) {
      return {
        ok: false,
        message:
          "Attach a PDF, Word/PowerPoint/Excel file, image, or MP4 — or paste a link instead.",
      };
    }
    await admin.storage
      .createBucket(BUCKET, { public: true })
      .catch(() => undefined);
    const path = `session-resources/${sessionId}/${Date.now()}.${kind.ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (uploadError) return { ok: false, message: uploadError.message };
    url = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    typeLabel = kind.label;
  } else {
    try {
      const parsed = new URL(linkUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
    } catch {
      return {
        ok: false,
        message: "That link doesn't look right — it should start with https://",
      };
    }
  }

  // Append at the end of the current order.
  const { data: last } = await admin
    .from("session_resources")
    .select("sort")
    .eq("session_id", sessionId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = ((last?.sort as number | undefined) ?? -1) + 1;

  const { error } = await admin.from("session_resources").insert({
    session_id: sessionId,
    name,
    type: typeLabel,
    url,
    sort,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Resource added." };
}

/** The session a resource belongs to — for ownership checks. */
export async function sessionIdOfResource(
  resourceId: string,
): Promise<string | null> {
  const admin = createServiceClient();
  const { data } = await admin
    .from("session_resources")
    .select("session_id")
    .eq("id", resourceId)
    .maybeSingle();
  return (data?.session_id as string | undefined) ?? null;
}

export async function deleteSessionResource(
  resourceId: string,
): Promise<ResourceResult> {
  const admin = createServiceClient();
  const { error } = await admin
    .from("session_resources")
    .delete()
    .eq("id", resourceId);
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Resource removed." };
}

/** Swap the resource with its neighbor above/below in the display order. */
export async function moveSessionResource(
  resourceId: string,
  direction: "up" | "down",
): Promise<ResourceResult> {
  const admin = createServiceClient();
  const { data: row } = await admin
    .from("session_resources")
    .select("id, session_id, sort")
    .eq("id", resourceId)
    .maybeSingle();
  if (!row) return { ok: false, message: "Resource not found." };

  const { data: all } = await admin
    .from("session_resources")
    .select("id, sort")
    .eq("session_id", row.session_id as string)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  const list = all ?? [];
  const idx = list.findIndex((r) => r.id === resourceId);
  const swapWith = direction === "up" ? list[idx - 1] : list[idx + 1];
  if (idx < 0 || !swapWith) return { ok: true }; // already at the edge

  // Normalize sorts to indexes while swapping — heals duplicate sort values.
  const updates = list.map((r, i) => {
    let sort = i;
    if (r.id === resourceId) sort = direction === "up" ? idx - 1 : idx + 1;
    else if (r.id === swapWith.id) sort = idx;
    return { id: r.id as string, sort };
  });
  for (const u of updates) {
    await admin
      .from("session_resources")
      .update({ sort: u.sort })
      .eq("id", u.id);
  }
  return { ok: true };
}

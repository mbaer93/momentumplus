"use server";

import { createHash } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSpeakerForUser, speakerOwnsSession } from "@/lib/speaker-tools";

/*
 * Speaker Studio self-service actions. Every action re-verifies ownership
 * server-side (active speaker record wired to the signed-in account, and —
 * for session tools — that the session is theirs). Member emails NEVER
 * travel to the speaker: notices fan out server-side and the speaker only
 * learns the recipient count.
 */

export interface StudioResult {
  ok: boolean;
  message?: string;
}

async function requireSpeaker() {
  if (!isSupabaseConfigured()) return { preview: true as const };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const speaker = await getSpeakerForUser(user.id);
  if (!speaker) return { error: "No active speaker profile on this account." };
  return { user, speaker };
}

/** Edit their own speaker-directory page. */
export async function updateOwnSpeakerPage(input: {
  name: string;
  title: string;
  bio: string;
  industries: string;
}): Promise<StudioResult> {
  const ctx = await requireSpeaker();
  if ("preview" in ctx) return { ok: true, message: "Saved (preview mode)." };
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const name = input.name.trim();
  if (!name) return { ok: false, message: "Your name can't be empty." };
  const { error } = await createServiceClient()
    .from("speakers")
    .update({
      name,
      title: input.title.trim() || null,
      bio: input.bio.trim() || null,
      industries: input.industries
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    })
    .eq("id", ctx.speaker.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/speakers");
  revalidatePath("/speaker");
  revalidateTag("speakers");
  return { ok: true, message: "Speaker page saved." };
}

/** Edit their single business-resource page. */
export async function updateOwnResource(input: {
  title: string;
  description: string;
  url: string;
}): Promise<StudioResult> {
  const ctx = await requireSpeaker();
  if ("preview" in ctx) return { ok: true, message: "Saved (preview mode)." };
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give the resource a title." };
  const admin = createServiceClient();

  if (ctx.speaker.resourceId) {
    const { error } = await admin
      .from("resources")
      .update({
        title,
        description: input.description.trim() || null,
        url: input.url.trim() || null,
      })
      .eq("id", ctx.speaker.resourceId);
    if (error) return { ok: false, message: error.message };
  } else {
    const { data: created, error } = await admin
      .from("resources")
      .insert({
        title,
        category: "Speaker Business",
        description: input.description.trim() || null,
        url: input.url.trim() || null,
        partner_name: ctx.speaker.name,
        min_access: "all_members",
        active: true,
      })
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, message: error?.message ?? "Couldn't save." };
    }
    await admin
      .from("speakers")
      .update({ resource_id: created.id })
      .eq("id", ctx.speaker.id);
  }
  revalidatePath("/resources");
  revalidatePath("/speaker");
  return { ok: true, message: "Resource page saved." };
}

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function imageFrom(
  formData: FormData,
): { file: File; ext: string } | { message: string } {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { message: "No file received — choose an image and try again." };
  }
  if (file.size > 4 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      message: `That image is ${mb} MB — the limit is 4 MB. Compress or resize it and try again.`,
    };
  }
  const ext = IMAGE_TYPES[file.type];
  if (!ext) {
    return {
      message: `That file type (${file.type || "unknown"}) isn't supported — use PNG, JPG, or WebP.`,
    };
  }
  return { file, ext };
}

/** Upload their own headshot — shown on their speaker-directory page. */
export async function uploadOwnHeadshot(
  formData: FormData,
): Promise<StudioResult> {
  const ctx = await requireSpeaker();
  if ("preview" in ctx) return { ok: true, message: "Uploaded (preview mode)." };
  if ("error" in ctx) return { ok: false, message: ctx.error };
  const img = imageFrom(formData);
  if ("message" in img) return { ok: false, message: img.message };

  const admin = createServiceClient();
  await admin.storage
    .createBucket("speaker-headshots", { public: true })
    .catch(() => undefined);
  const path = `${ctx.speaker.id}.${img.ext}`;
  const bytes = Buffer.from(await img.file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from("speaker-headshots")
    .upload(path, bytes, { contentType: img.file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };
  const { data: pub } = admin.storage
    .from("speaker-headshots")
    .getPublicUrl(path);
  const { error } = await admin
    .from("speakers")
    .update({ headshot_url: `${pub.publicUrl}?v=${Date.now()}` })
    .eq("id", ctx.speaker.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/speakers");
  revalidatePath("/speaker");
  revalidateTag("speakers");
  return { ok: true, message: "Headshot uploaded." };
}

/** Upload the logo/image shown on their business-resource card. */
export async function uploadOwnResourceLogo(
  formData: FormData,
): Promise<StudioResult> {
  const ctx = await requireSpeaker();
  if ("preview" in ctx) return { ok: true, message: "Uploaded (preview mode)." };
  if ("error" in ctx) return { ok: false, message: ctx.error };
  if (!ctx.speaker.resourceId) {
    return {
      ok: false,
      message: "Save your resource page first — then add the logo.",
    };
  }
  const img = imageFrom(formData);
  if ("message" in img) return { ok: false, message: img.message };

  const admin = createServiceClient();
  await admin.storage
    .createBucket(SHARE_BUCKET, { public: true })
    .catch(() => undefined);
  const path = `logo-${ctx.speaker.resourceId}.${img.ext}`;
  const bytes = Buffer.from(await img.file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(SHARE_BUCKET)
    .upload(path, bytes, { contentType: img.file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };
  const { data: pub } = admin.storage.from(SHARE_BUCKET).getPublicUrl(path);
  const { error } = await admin
    .from("resources")
    .update({ image_url: `${pub.publicUrl}?v=${Date.now()}` })
    .eq("id", ctx.speaker.resourceId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/resources");
  revalidatePath("/speaker");
  return { ok: true, message: "Logo uploaded." };
}

const SHARE_BUCKET = "resource-images"; // existing public bucket
const SHARE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "video/mp4": "mp4",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/**
 * Send a notice (and optionally a document/video link or uploaded file) to
 * everyone enrolled in one of the speaker's sessions. Emails are resolved
 * and sent entirely server-side — the speaker never sees an address, only
 * how many members were reached.
 */
export async function sendSessionNotice(
  formData: FormData,
): Promise<StudioResult & { recipients?: number }> {
  const ctx = await requireSpeaker();
  if ("preview" in ctx) {
    return { ok: true, recipients: 12, message: "Notice sent (preview mode) to 12 enrolled members." };
  }
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const sessionId = String(formData.get("sessionId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const linkUrl = String(formData.get("linkUrl") ?? "").trim();
  if (!subject || !message) {
    return { ok: false, message: "A subject and a message are both needed." };
  }

  const owns = await speakerOwnsSession(ctx.user.id, sessionId);
  if (!owns.ok) return { ok: false, message: "That session isn't yours." };

  const admin = createServiceClient();
  const { data: session } = await admin
    .from("sessions")
    .select("title")
    .eq("id", sessionId)
    .maybeSingle();

  // Optional attachment → public storage link included in the email.
  let attachmentUrl: string | null = null;
  let attachmentName: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 25 * 1024 * 1024) {
      return { ok: false, message: "Attachments are limited to 25 MB — share bigger videos as a link instead." };
    }
    const ext = SHARE_TYPES[file.type];
    if (!ext) {
      return {
        ok: false,
        message: "Attach a PDF, Word/PowerPoint file, image, or MP4 — or paste a link instead.",
      };
    }
    await admin.storage
      .createBucket(SHARE_BUCKET, { public: true })
      .catch(() => undefined);
    const path = `speaker-shares/${sessionId}/${Date.now()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(SHARE_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (uploadError) return { ok: false, message: uploadError.message };
    attachmentUrl = admin.storage.from(SHARE_BUCKET).getPublicUrl(path).data.publicUrl;
    attachmentName = file.name;
  }

  // Recipients: enrollees' emails, resolved server-side only.
  const { data: enrollees } = await admin
    .from("enrollments")
    .select("profile_id, profiles ( email, full_name )")
    .eq("session_id", sessionId);
  const recipients = (enrollees ?? [])
    .map((r) => {
      const p = (
        r as unknown as {
          profiles: { email: string | null; full_name: string | null } | null;
        }
      ).profiles;
      return { profileId: r.profile_id as string, email: p?.email ?? null };
    })
    .filter((r): r is { profileId: string; email: string } => Boolean(r.email));

  // GHL delivery needs each member's contact id (from their membership row).
  const contactIds = new Map<string, string>();
  if (recipients.length > 0) {
    const { data: memberships } = await admin
      .from("memberships")
      .select("profile_id, ghl_contact_id")
      .in(
        "profile_id",
        recipients.map((r) => r.profileId),
      )
      .not("ghl_contact_id", "is", null);
    for (const m of memberships ?? []) {
      if (!contactIds.has(m.profile_id as string)) {
        contactIds.set(m.profile_id as string, m.ghl_contact_id as string);
      }
    }
  }

  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.65;">${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const linkBlock = [
    linkUrl
      ? `<p style="margin:0 0 10px;"><a href="${esc(linkUrl)}" style="color:#B8965A;font-weight:bold;">${esc(linkUrl)}</a></p>`
      : "",
    attachmentUrl
      ? `<p style="margin:0 0 10px;"><a href="${esc(attachmentUrl)}" style="color:#B8965A;font-weight:bold;">Download: ${esc(attachmentName ?? "attachment")}</a></p>`
      : "",
  ].join("");
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#B8965A;font-weight:bold;">
        From your session speaker — ${esc(ctx.speaker.name)}
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">
        Re: ${esc((session?.title as string) ?? "your enrolled session")}
      </p>
      ${paragraphs}
      ${linkBlock}
      <p style="margin:18px 0 0;font-size:11.5px;color:#9ca3af;">
        Sent through Momentum+ to members enrolled in this session. Replies
        don't reach the speaker — use the community to respond.
      </p>
    </div>
  </div>`;

  // Delivery ledger: each recipient gets a notifications row (their in-app
  // bell) whose link encodes THIS notice — re-sending the same notice skips
  // members already reached, so a timeout or double-click never re-emails
  // all 350 enrollees.
  const noticeHash = createHash("sha256")
    .update(`${sessionId}|${subject}|${message}`)
    .digest("hex")
    .slice(0, 16);
  const noticeLink = `/sessions/${sessionId}?notice=${noticeHash}`;
  const alreadySent = new Set<string>();
  if (recipients.length > 0) {
    const { data: markers } = await admin
      .from("notifications")
      .select("profile_id")
      .eq("kind", "speaker_notice")
      .eq("link", noticeLink)
      .in(
        "profile_id",
        recipients.map((r) => r.profileId),
      );
    for (const m of markers ?? []) alreadySent.add(m.profile_id as string);
  }

  // Sequential GHL sends across a big roster can outlast the function
  // window — stop before the platform kills the action mid-send and tell
  // the speaker how to resume.
  const EMAIL_BUDGET_MS = 240_000;
  const startedAt = Date.now();

  const { sendEmailViaGhl } = await import("@/lib/notifications");
  let sent = 0;
  let skipped = 0;
  let remainingForBudget = 0;
  for (const r of recipients) {
    if (alreadySent.has(r.profileId)) {
      skipped++;
      continue;
    }
    if (Date.now() - startedAt > EMAIL_BUDGET_MS) {
      remainingForBudget++;
      continue;
    }
    const res = await sendEmailViaGhl({
      contactId: contactIds.get(r.profileId) ?? null,
      email: r.email,
      subject: `[Momentum+] ${subject}`,
      html,
    });
    if (res.sent) sent++;
    // Marker AFTER the attempt: a crash mid-run re-tries the unmarked tail
    // on the next send instead of silently dropping it. The row is also the
    // member's bell notification for this notice.
    await admin.from("notifications").insert({
      profile_id: r.profileId,
      kind: "speaker_notice",
      title: `Notice from ${ctx.speaker.name}`,
      body: subject,
      link: noticeLink,
    });
  }

  const reached = sent + skipped;
  return {
    ok: true,
    recipients: recipients.length,
    message:
      recipients.length === 0
        ? "No one is enrolled in that session yet."
        : remainingForBudget > 0
          ? `Notice sent to ${reached} of ${recipients.length} so far — ${remainingForBudget} still to send. Press Send again to continue; members already reached are skipped automatically.`
          : skipped > 0
            ? `Notice sent to ${sent} more member${sent === 1 ? "" : "s"} (${skipped} had already received it).`
            : `Notice sent to ${sent} of ${recipients.length} enrolled member${recipients.length === 1 ? "" : "s"}.`,
  };
}

/** Edit the title/category of a library item from one of their sessions. */
export async function updateOwnVideo(
  videoId: string,
  input: { title: string; category: string },
): Promise<StudioResult> {
  const ctx = await requireSpeaker();
  if ("preview" in ctx) return { ok: true, message: "Saved (preview mode)." };
  if ("error" in ctx) return { ok: false, message: ctx.error };

  const admin = createServiceClient();
  const { data: video } = await admin
    .from("videos")
    .select("id, session_id, sessions!inner ( speaker_id )")
    .eq("id", videoId)
    .maybeSingle();
  const speakerId = (
    video as unknown as { sessions: { speaker_id: string | null } } | null
  )?.sessions?.speaker_id;
  if (!video || speakerId !== ctx.speaker.id) {
    return { ok: false, message: "That library item isn't yours." };
  }
  const title = input.title.trim();
  if (!title) return { ok: false, message: "The title can't be empty." };
  const { error } = await admin
    .from("videos")
    .update({ title, category: input.category.trim() || null })
    .eq("id", videoId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/library");
  revalidatePath("/speaker");
  return { ok: true, message: "Library item saved." };
}

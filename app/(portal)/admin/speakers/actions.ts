"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { emailPattern } from "@/lib/db-utils";
import { seasonEnd } from "@/lib/sponsor-lifecycle";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface SpeakerInput {
  name: string;
  title: string;
  bio: string;
  /** Comma-separated in the UI, stored as text[]. */
  industries: string;
  website: string;
  featured: boolean;
}

export interface AdminResult {
  ok: boolean;
  message?: string;
  preview?: boolean;
}

function toRow(input: SpeakerInput) {
  return {
    name: input.name.trim(),
    title: input.title.trim() || null,
    bio: input.bio.trim() || null,
    industries: input.industries
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    website: input.website.trim() || null,
    featured: input.featured,
  };
}

async function guard(): Promise<AdminResult | null> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };
  return null;
}

function refresh() {
  revalidatePath("/admin/speakers");
  revalidatePath("/speakers");
  revalidateTag("speakers");
}

export async function createSpeaker(input: SpeakerInput): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("speakers").insert(toRow(input));
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Speaker added." };
}

export async function updateSpeaker(
  id: string,
  input: SpeakerInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("speakers")
    .update(toRow(input))
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Speaker saved." };
}

const HEADSHOT_BUCKET = "speaker-headshots";
const HEADSHOT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Upload a speaker headshot (square crop looks best; PNG/JPG/WebP, <4 MB). */
export async function uploadSpeakerHeadshot(
  id: string,
  formData: FormData,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No file received — choose an image and try again." };
  }
  if (file.size > 4 * 1024 * 1024) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      message: `That image is ${mb} MB — the limit is 4 MB. Compress or resize it and try again.`,
    };
  }
  const ext = HEADSHOT_TYPES[file.type];
  if (!ext) {
    return {
      ok: false,
      message: `That file type (${file.type || "unknown"}) isn't supported — use PNG, JPG, or WebP.`,
    };
  }

  const admin = createServiceClient();
  await admin.storage
    .createBucket(HEADSHOT_BUCKET, { public: true })
    .catch(() => undefined);
  const path = `${id}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from(HEADSHOT_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (uploadError) return { ok: false, message: uploadError.message };

  const { data: pub } = admin.storage.from(HEADSHOT_BUCKET).getPublicUrl(path);
  const { error } = await admin
    .from("speakers")
    .update({ headshot_url: `${pub.publicUrl}?v=${Date.now()}` })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Headshot uploaded." };
}

export async function removeSpeakerHeadshot(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("speakers")
    .update({ headshot_url: null })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Headshot removed." };
}

export async function deleteSpeaker(id: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient().from("speakers").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Speaker deleted." };
}


/* =====================================================================
   Speaker lifecycle (Matt, 2026-07-17): invite a speaker by email; they
   self-serve their speaker page, personal profile, and one business
   resource at /speaker-onboarding. Access runs through October 1 of the
   year after they join; archiving takes the speaker AND their sessions
   and library items out of member view (never deleted, reinstatable).
   ===================================================================== */

export interface SpeakerInviteResult extends AdminResult {
  loginLink?: string | null;
}

export async function inviteSpeaker(
  emailRaw: string,
  displayName: string,
): Promise<SpeakerInviteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Invite sent (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "That doesn't look like a valid email." };
  }

  const admin = createServiceClient();
  const { data: pending } = await admin
    .from("speaker_invites")
    .select("id")
    .ilike("email", emailPattern(email))
    .is("completed_at", null)
    .maybeSingle();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", emailPattern(email))
    .maybeSingle();

  let profileId: string | null = profile?.id ?? null;
  let accountCreated = false;
  let invited = false;
  let loginLink: string | null = null;

  if (!profileId) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const { data: inv } = await admin.auth.admin.inviteUserByEmail(email, {
      data: displayName.trim() ? { full_name: displayName.trim() } : undefined,
      redirectTo: siteUrl
        ? `${siteUrl}/auth/callback?redirect=/speaker-onboarding`
        : undefined,
    });
    if (inv?.user) {
      profileId = inv.user.id;
      invited = true;
      accountCreated = true;
    } else {
      const { findAuthUserIdByEmail, createAccountWithoutEmail } =
        await import("@/lib/onboarding");
      profileId = await findAuthUserIdByEmail(email);
      if (!profileId) {
        const created = await createAccountWithoutEmail(email, displayName);
        profileId = created.profileId;
        loginLink = created.loginLink ?? null;
        accountCreated = true;
      }
    }
  }
  if (!profileId) {
    return { ok: false, message: "Couldn't create an account for that email." };
  }

  const row = {
    email,
    display_name: displayName.trim() || null,
    invited_profile_id: profileId,
    account_created: accountCreated,
    created_by: auth.userId,
    completed_at: null,
  };
  const { error } = pending
    ? await admin.from("speaker_invites").update(row).eq("id", pending.id)
    : await admin.from("speaker_invites").insert(row);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/speakers");
  return {
    ok: true,
    loginLink,
    message: invited
      ? `Invite sent to ${email} — the email walks them through building their speaker page.`
      : loginLink
        ? `Account created but the invite email failed — copy the sign-in link below and send it to ${email} yourself.`
        : `${email} already has a Momentum+ account — they'll see the speaker setup form at momentumplus.co/speaker-onboarding next time they sign in (send them that link).`,
  };
}

/** Archive a speaker + their sessions + their library items (member view
    only — nothing is deleted). */
export async function archiveSpeaker(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Archived (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data: speaker, error } = await admin
    .from("speakers")
    .update({ archived_at: nowIso, featured: false })
    .eq("id", id)
    .select("profile_id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };

  // Their sessions leave member view…
  const { data: sessions } = await admin
    .from("sessions")
    .select("id")
    .eq("speaker_id", id);
  const sessionIds = (sessions ?? []).map((s) => s.id as string);
  if (sessionIds.length > 0) {
    await admin
      .from("sessions")
      .update({ status: "archived" })
      .in("id", sessionIds)
      .neq("status", "archived");
    // …and so do the recordings attached to those sessions.
    await admin
      .from("videos")
      .update({ archived_at: nowIso })
      .in("session_id", sessionIds)
      .is("archived_at", null);
  }

  // End their speaker access.
  if (speaker?.profile_id) {
    await admin
      .from("memberships")
      .update({ status: "expired", access_expires_at: nowIso })
      .eq("profile_id", speaker.profile_id)
      .eq("source", "speaker")
      .eq("status", "active");
  }

  refresh();
  revalidatePath("/sessions");
  revalidatePath("/library");
  return {
    ok: true,
    message:
      "Speaker archived — their profile, sessions, and library items are hidden from members. Reinstate anytime.",
  };
}

/** Bring a past speaker back through the next season end. Their library
    items return too; ARCHIVED SESSIONS STAY ARCHIVED (re-publish any
    future sessions from Admin → Sessions so dates/Zoom get re-checked). */
export async function reinstateSpeaker(id: string): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Reinstated (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const termEnd = seasonEnd().toISOString();
  const { data: speaker, error } = await admin
    .from("speakers")
    .update({ archived_at: null, expires_at: termEnd })
    .eq("id", id)
    .select("profile_id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };

  const { data: sessions } = await admin
    .from("sessions")
    .select("id")
    .eq("speaker_id", id);
  const sessionIds = (sessions ?? []).map((s) => s.id as string);
  if (sessionIds.length > 0) {
    await admin
      .from("videos")
      .update({ archived_at: null })
      .in("session_id", sessionIds);
  }

  if (speaker?.profile_id) {
    const { data: existing } = await admin
      .from("memberships")
      .select("id")
      .eq("profile_id", speaker.profile_id)
      .eq("source", "speaker")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      await admin
        .from("memberships")
        .update({ status: "active", access_expires_at: termEnd })
        .eq("id", existing.id);
    } else {
      await admin.from("memberships").insert({
        profile_id: speaker.profile_id,
        tier: "speaker",
        status: "active",
        access_starts_at: new Date().toISOString(),
        access_expires_at: termEnd,
        source: "speaker",
      });
    }
  }

  refresh();
  revalidatePath("/sessions");
  revalidatePath("/library");
  return {
    ok: true,
    message: `Speaker reinstated through ${new Date(termEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Library items restored; re-publish any upcoming sessions from Admin → Sessions.`,
  };
}

"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { emailPattern } from "@/lib/db-utils";
import { seasonEnd, speakerLive, upcomingSeasonStart } from "@/lib/sponsor-lifecycle";
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

/**
 * Withdraw a pending speaker invite. Stale invites are worse than clutter:
 * the /welcome and /expired self-heals route that email into speaker
 * onboarding on every login, so an abandoned test invite can lock a later
 * REGULAR member out of the portal entirely. The auth account (if one was
 * created) is untouched — it simply signs in as a normal account.
 */
export async function cancelSpeakerInvite(inviteId: string): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const { error } = await createServiceClient()
    .from("speaker_invites")
    .delete()
    .eq("id", inviteId)
    .is("completed_at", null);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Invite cancelled — that email now logs in as a regular account." };
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

  // Existing accounts get no Supabase invite email — without our own email
  // the invite silently dies unless the admin remembers to chase it.
  let existingNote = "";
  if (!invited && !accountCreated) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    try {
      const { sendEmailViaGhl } = await import("@/lib/notifications");
      const res = await sendEmailViaGhl({
        email,
        subject: "[Momentum+] You're invited to speak",
        html: `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 12px;font-size:14px;">Hi${displayName.trim() ? ` ${esc(displayName.trim().split(/\s+/)[0])}` : ""},</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">
        You&rsquo;ve been invited to speak on Momentum+. Sign in with this
        email address and a short setup builds your speaker page, personal
        profile, and business resource — you also get full Pro-level access
        through the season.
      </p>
      <p style="margin:0 0 6px;">
        <a href="${site}/speaker-onboarding" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:4px;text-decoration:none;">Set up your speaker page</a>
      </p>
    </div>
  </div>`,
      });
      existingNote = res.sent
        ? ` We emailed them the setup link.`
        : ` (The setup email couldn't be sent — ${res.reason ?? "unknown"} — so send them momentumplus.co/speaker-onboarding yourself.)`;
    } catch {
      existingNote =
        " (The setup email couldn't be sent — send them momentumplus.co/speaker-onboarding yourself.)";
    }
  }

  revalidatePath("/admin/speakers");
  return {
    ok: true,
    loginLink,
    message: invited
      ? `Invite sent to ${email} — the email walks them through building their speaker page.`
      : loginLink
        ? `Account created but the invite email failed — copy the sign-in link below and send it to ${email} yourself.`
        : `${email} already has a Momentum+ account — they'll be routed to speaker setup next time they sign in.${existingNote}`,
  };
}

/**
 * Toggle a speaker between the season term and ONGOING (no end date).
 * Ongoing speakers never come down automatically — and with no season start
 * to wait for, they're visible to members immediately. Their Speaker
 * membership follows the term.
 */
export async function setSpeakerOngoing(
  id: string,
  ongoing: boolean,
): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Saved (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const termEnd = ongoing ? null : seasonEnd().toISOString();
  const { data: speaker, error } = await admin
    .from("speakers")
    .update({ expires_at: termEnd })
    .eq("id", id)
    .select("profile_id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };

  let accessWarning = "";
  if (speaker?.profile_id) {
    const { error: accessError } = await admin
      .from("memberships")
      .update({ access_expires_at: termEnd })
      .eq("profile_id", speaker.profile_id)
      .eq("source", "speaker")
      .eq("status", "active");
    if (accessError) {
      accessWarning = membershipWarning(
        "their portal access could NOT be updated to match",
        accessError.message,
      );
    }
  }

  refresh();
  if (accessWarning) {
    return { ok: false, message: `Speaker term updated, but ${accessWarning}` };
  }
  return {
    ok: true,
    message: ongoing
      ? "Ongoing speaker — no season end. They're visible to members now, never come down automatically, and their Studio access doesn't expire."
      : `Back on the season clock — this speaker and their access now end ${new Date(termEnd as string).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
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
    .select("profile_id, resource_id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };

  // Their business resource comes down too — archiving promised to take
  // "the speaker AND their content" out of member view, but the promo link
  // used to stay on /resources forever.
  if (speaker?.resource_id) {
    await admin
      .from("resources")
      .update({ active: false })
      .eq("id", speaker.resource_id);
    revalidatePath("/resources");
  }

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
  let accessWarning = "";
  if (speaker?.profile_id) {
    const { error: accessError } = await admin
      .from("memberships")
      .update({ status: "expired", access_expires_at: nowIso })
      .eq("profile_id", speaker.profile_id)
      .eq("source", "speaker")
      .eq("status", "active");
    if (accessError) {
      accessWarning = membershipWarning(
        "their portal access could NOT be revoked",
        accessError.message,
      );
    }
  }

  refresh();
  revalidatePath("/sessions");
  revalidatePath("/library");
  if (accessWarning) {
    return {
      ok: false,
      message: `Speaker archived and their content is hidden, but ${accessWarning}`,
    };
  }
  return {
    ok: true,
    message:
      "Speaker archived — their profile, sessions, library items, and business resource are hidden from members. Reinstate anytime.",
  };
}

/** Membership writes for speakers fail loudly instead of silently — the
    most likely cause is a database missing migration 0036. */
function membershipWarning(what: string, detail: string): string {
  const hint = /membership_source/i.test(detail)
    ? " Run migration 0036 in the Supabase SQL editor, then retry."
    : "";
  return `${what}: ${detail}.${hint}`;
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
    .select("profile_id, resource_id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };

  if (speaker?.resource_id) {
    await admin
      .from("resources")
      .update({ active: true })
      .eq("id", speaker.resource_id);
    revalidatePath("/resources");
  }

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

  let accessWarning = "";
  if (speaker?.profile_id) {
    const { data: existing, error: lookupError } = await admin
      .from("memberships")
      .select("id")
      .eq("profile_id", speaker.profile_id)
      .eq("source", "speaker")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupError) {
      accessWarning = membershipWarning(
        "their portal access could NOT be restored",
        lookupError.message,
      );
    } else if (existing) {
      const { error: updateError } = await admin
        .from("memberships")
        .update({ status: "active", access_expires_at: termEnd })
        .eq("id", existing.id);
      if (updateError) {
        accessWarning = membershipWarning(
          "their portal access could NOT be restored",
          updateError.message,
        );
      }
    } else {
      const { error: insertError } = await admin.from("memberships").insert({
        profile_id: speaker.profile_id,
        tier: "speaker",
        status: "active",
        access_starts_at: new Date().toISOString(),
        access_expires_at: termEnd,
        source: "speaker",
      });
      if (insertError) {
        accessWarning = membershipWarning(
          "their portal access could NOT be restored",
          insertError.message,
        );
      }
    }
  }

  refresh();
  revalidatePath("/sessions");
  revalidatePath("/library");
  if (accessWarning) {
    return {
      ok: false,
      message: `Speaker profile and library items are back, but ${accessWarning}`,
    };
  }
  // Honesty about visibility: a reinstate outside the live season puts them
  // back on the roster but members still can't see them until October 1.
  const liveNow = speakerLive({ archivedAt: null, expiresAt: termEnd });
  const endLabel = new Date(termEnd).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return {
    ok: true,
    message: liveNow
      ? `Speaker reinstated — visible to members again, through ${endLabel}. Library items and business resource restored; re-publish any upcoming sessions from Admin → Sessions.`
      : `Speaker reinstated through ${endLabel} — they return to member view on ${upcomingSeasonStart().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} (until then they can prep in their Studio). Library items and business resource restored; re-publish any upcoming sessions from Admin → Sessions.`,
  };
}

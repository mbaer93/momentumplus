"use server";

import { revalidatePath, updateTag } from "next/cache";
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
  /** Where we reach the speaker (invites) — filled by the TSLS pull or an
      admin; distinct from their account email until they have an account. */
  contactEmail?: string;
  /** Momentum+ speaker-of-the-month assignment, "YYYY-MM" ("" = none). */
  speakerMonth?: string;
  /** TSLS Main Speakers are unpaid — hides the earnings line in their Studio. */
  tslsMainSpeaker?: boolean;
  /** Admin-only payment access (migration 0082). Undefined means "leave it
      on" — only an explicit false takes a speaker off the payment feature,
      so a caller that predates this field can't strip access by omission. */
  paymentAccess?: boolean;
  /** Admin-only waiver of the Leadership Advisor Agreement (migration 0083).
      Undefined means "not waived" — the mirror image of paymentAccess above,
      so an older caller can never drop the signature requirement by
      omission. */
  advisorAgreementWaived?: boolean;
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
    contact_email: input.contactEmail?.trim().toLowerCase() || null,
    featured: input.featured,
    // Only a valid YYYY-MM passes; anything else clears the assignment (the
    // DB check constraint would reject it anyway).
    speaker_month: /^\d{4}-(0[1-9]|1[0-2])$/.test(input.speakerMonth ?? "")
      ? input.speakerMonth
      : null,
    tsls_main_speaker: Boolean(input.tslsMainSpeaker),
    // Admin-only, and the ONLY writer of this column: the TSLS pull and
    // Speaker Studio both write explicit field lists that omit it.
    payment_access: input.paymentAccess !== false,
    // Same rule, opposite default: only an admin can waive the agreement,
    // and only by explicitly ticking the box.
    advisor_agreement_waived: input.advisorAgreementWaived === true,
  };
}

/** Friendly hint when a schema column isn't deployed yet. */
function migrationHint(message: string): string {
  if (/contact_email/.test(message)) {
    return "The database doesn't have the speaker contact-email column yet — run migration 0074 first.";
  }
  if (/payment_access/.test(message)) {
    return "The database doesn't have the speaker payment-access column yet — run migration 0082 first.";
  }
  if (/advisor_agreement_waived|advisor_agreements/.test(message)) {
    return "The database doesn't have the Leadership Advisor Agreement tables yet — run migration 0083 first.";
  }
  return /speaker_month|tsls_main_speaker/.test(message)
    ? "The database doesn't have the speaker-month columns yet — run migration 0053 first."
    : message;
}

/** A permissive shape check — real validation is "the invite email arrives". */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
  updateTag("speakers");
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

/**
 * Pull the TSLS speaker lineup into Momentum+ (Matt, 2026-08-05). The rule:
 * every TSLS speaker becomes a Momentum+ speaker — main stage AND panelists —
 * except the Emcee, the one exception. Momentum+-only speakers are never
 * touched, existing speakers only gain missing fields (a filled field is
 * never overwritten), and NO accounts are provisioned and NO emails sent —
 * this creates listings; invites stay a deliberate separate step.
 */
export async function pullSpeakersFromTsls(): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;

  const { fetchTslsSpeakers, speakerNameKey, findLikelyDuplicates } = await import(
    "@/lib/tsls-speakers"
  );
  const fetched = await fetchTslsSpeakers();
  if (!fetched.ok) return { ok: false, message: fetched.message };

  const admin = createServiceClient();
  // contact_email arrives with migration 0074 — degrade gracefully until run.
  let hasContactEmail = true;
  let res = await admin
    .from("speakers")
    .select(
      "id, name, profile_id, title, bio, headshot_url, website, industries, tsls_main_speaker, contact_email",
    );
  if (res.error && /contact_email/.test(res.error.message)) {
    hasContactEmail = false;
    res = await admin
      .from("speakers")
      .select("id, name, profile_id, title, bio, headshot_url, website, industries, tsls_main_speaker");
  }
  if (res.error) return { ok: false, message: res.error.message };
  const existing = (res.data ?? []) as Array<{
    id: string;
    name: string;
    profile_id: string | null;
    title: string | null;
    bio: string | null;
    headshot_url: string | null;
    website: string | null;
    industries: string[] | null;
    tsls_main_speaker: boolean | null;
    contact_email?: string | null;
  }>;

  // Match by account email first, then by normalized name (credentials,
  // middle initials, and casing vary between the two apps).
  const profileIds = existing
    .map((s) => s.profile_id as string | null)
    .filter((v): v is string => Boolean(v));
  const emailToSpeaker = new Map<string, (typeof existing)[number]>();
  if (profileIds.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, email")
      .in("id", profileIds);
    const byProfile = new Map(existing.map((s) => [s.profile_id, s]));
    for (const p of profs ?? []) {
      const sp = byProfile.get(p.id);
      if (sp && p.email) emailToSpeaker.set(String(p.email).toLowerCase(), sp);
    }
  }
  // Contact emails from earlier pulls / admin edits match too.
  for (const s of existing) {
    if (s.contact_email) {
      emailToSpeaker.set(String(s.contact_email).toLowerCase(), s);
    }
  }
  const nameToSpeaker = new Map(
    existing.map((s) => [speakerNameKey(String(s.name)), s]),
  );

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let emcees = 0;
  const failed: string[] = [];

  for (const ts of fetched.speakers) {
    // The Emcee is the exception to "all TSLS speakers are Momentum+
    // speakers" — never imported.
    if (ts.role === "emcee") {
      emcees++;
      continue;
    }
    const match =
      (ts.email ? emailToSpeaker.get(ts.email) : undefined) ??
      nameToSpeaker.get(speakerNameKey(ts.name));

    if (match) {
      // Fill blanks only; an admin- or speaker-curated field always wins.
      const patch: Record<string, unknown> = {};
      if (!match.title && ts.title) patch.title = ts.title;
      if (!match.bio && ts.bio) patch.bio = ts.bio;
      if (!match.headshot_url && ts.headshotUrl) patch.headshot_url = ts.headshotUrl;
      if (!match.website && ts.website) patch.website = ts.website;
      if ((match.industries ?? []).length === 0 && ts.tags.length > 0) {
        patch.industries = ts.tags;
      }
      if (ts.role === "main" && !match.tsls_main_speaker) {
        patch.tsls_main_speaker = true;
      }
      // TSLS emails carry over so invites can go out (Matt, 2026-08-05) —
      // fill-blank only, an admin-corrected email is never overwritten.
      if (hasContactEmail && !match.contact_email && ts.email) {
        patch.contact_email = ts.email;
      }
      if (Object.keys(patch).length === 0) {
        unchanged++;
        continue;
      }
      const { error: upErr } = await admin
        .from("speakers")
        .update(patch)
        .eq("id", match.id);
      if (upErr) failed.push(`${ts.name} — ${upErr.message}`);
      else updated++;
      continue;
    }

    // New to Momentum+: create the listing. Link an account only if one
    // already exists for the email — never create one here.
    let profileId: string | null = null;
    if (ts.email) {
      const { findAuthUserIdByEmail } = await import("@/lib/onboarding");
      profileId = await findAuthUserIdByEmail(ts.email);
    }
    const { error: insErr } = await admin.from("speakers").insert({
      profile_id: profileId,
      name: ts.name,
      title: ts.title,
      bio: ts.bio,
      headshot_url: ts.headshotUrl,
      industries: ts.tags,
      links: ts.website ? { website: ts.website } : {},
      website: ts.website,
      tsls_main_speaker: ts.role === "main",
      ...(hasContactEmail ? { contact_email: ts.email } : {}),
    });
    if (insErr) failed.push(`${ts.name} — ${migrationHint(insErr.message)}`);
    else added++;
  }

  refresh();
  const failNote =
    failed.length > 0
      ? ` Failed: ${failed.slice(0, 5).join("; ")}${failed.length > 5 ? `; +${failed.length - 5} more` : ""}.`
      : "";

  // A pull that duplicated instead of updating used to look exactly like a
  // successful one — the extra rows were simply counted as "added" (Matt,
  // 2026-08-11). Re-read the table and say so plainly.
  let dupeNote = "";
  const { data: after } = await admin.from("speakers").select("id, name");
  const dupes = findLikelyDuplicates(
    (after ?? []).map((r) => ({ id: String(r.id), name: String(r.name) })),
  );
  if (dupes.length > 0) {
    const names = dupes
      .slice(0, 5)
      .map((d) => d.rows.map((r) => r.name).join(" / "))
      .join("; ");
    dupeNote =
      ` ⚠ ${dupes.length} possible duplicate${dupes.length === 1 ? "" : "s"}` +
      ` in Speakers: ${names}${dupes.length > 5 ? "; …" : ""}.` +
      ` Open each and delete the empty one — the pull won't merge them for you.`;
  }

  return {
    ok: failed.length === 0,
    message:
      `Pulled ${fetched.speakers.length} from TSLS: ${added} added, ${updated} updated, ` +
      `${unchanged} already current, ${emcees} emcee${emcees === 1 ? "" : "s"} skipped.` +
      `${failNote}${dupeNote}`,
  };
}

export async function createSpeaker(input: SpeakerInput): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const email = input.contactEmail?.trim() ?? "";
  if (email && !looksLikeEmail(email)) {
    return { ok: false, message: "That contact email doesn't look valid." };
  }
  const { error } = await createServiceClient().from("speakers").insert(toRow(input));
  if (error) return { ok: false, message: migrationHint(error.message) };
  refresh();
  return { ok: true, message: "Speaker added." };
}

export async function updateSpeaker(
  id: string,
  input: SpeakerInput,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  const email = input.contactEmail?.trim() ?? "";
  if (email && !looksLikeEmail(email)) {
    return { ok: false, message: "That contact email doesn't look valid." };
  }
  const { error } = await createServiceClient()
    .from("speakers")
    .update(toRow(input))
    .eq("id", id);
  if (error) return { ok: false, message: migrationHint(error.message) };
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
 * Send the login invite to ONE speaker listing, using its contact email
 * (Matt, 2026-08-05: emails ride over from TSLS; login info goes out only
 * when an admin clicks — one at a time or all at once). Reuses the full
 * inviteSpeaker flow (account creation, branded email, speaker_invites
 * row, /speaker-onboarding routing), then links the account back to the
 * listing so their Studio edits land on this speaker page.
 */
export async function inviteSpeakerListing(
  speakerId: string,
): Promise<SpeakerInviteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Invite sent (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data: sp, error } = await admin
    .from("speakers")
    .select("id, name, profile_id, contact_email")
    .eq("id", speakerId)
    .maybeSingle();
  if (error) return { ok: false, message: migrationHint(error.message) };
  if (!sp) return { ok: false, message: "That speaker no longer exists." };
  const email = (sp.contact_email as string | null)?.trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      message: "No email on this speaker — add one in the editor first.",
    };
  }

  const result = await inviteSpeaker(email, String(sp.name));
  if (!result.ok) return result;

  // Link the (possibly just-created) account to this listing so speaker
  // self-service edits update THIS page rather than minting a duplicate.
  if (!sp.profile_id) {
    const { findAuthUserIdByEmail } = await import("@/lib/onboarding");
    const profileId = await findAuthUserIdByEmail(email);
    if (profileId) {
      await admin
        .from("speakers")
        .update({ profile_id: profileId })
        .eq("id", speakerId)
        .is("profile_id", null);
    }
  }
  refresh();
  return result;
}

/**
 * Send login invites to EVERY active speaker listing that has a contact
 * email and no linked account yet. Speakers already invited (pending
 * speaker_invites row) or already holding an account are skipped — safe to
 * click repeatedly, only ever emails people who still need login info.
 */
export async function inviteAllSpeakerListings(): Promise<AdminResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, preview: true, message: "Invites sent (preview mode)." };
  }
  const auth = await requireAdmin("content");
  if (!auth.ok) return { ok: false, message: auth.message };

  const admin = createServiceClient();
  const { data: rows, error } = await admin
    .from("speakers")
    .select("id, name, profile_id, contact_email, archived_at")
    .is("archived_at", null);
  if (error) return { ok: false, message: migrationHint(error.message) };

  const { data: pending } = await admin
    .from("speaker_invites")
    .select("email")
    .is("completed_at", null);
  const pendingEmails = new Set(
    (pending ?? []).map((i) => String(i.email).toLowerCase()),
  );

  let sent = 0;
  let hasAccount = 0;
  let alreadyInvited = 0;
  let noEmail = 0;
  const failed: string[] = [];
  for (const sp of rows ?? []) {
    const email = (sp.contact_email as string | null)?.trim().toLowerCase();
    if (sp.profile_id) {
      hasAccount++;
      continue;
    }
    if (!email) {
      noEmail++;
      continue;
    }
    if (pendingEmails.has(email)) {
      alreadyInvited++;
      continue;
    }
    const res = await inviteSpeakerListing(String(sp.id));
    if (res.ok) sent++;
    else failed.push(`${sp.name} — ${res.message ?? "failed"}`);
  }

  refresh();
  const parts = [`${sent} invite${sent === 1 ? "" : "s"} sent`];
  if (alreadyInvited) parts.push(`${alreadyInvited} already invited`);
  if (hasAccount) parts.push(`${hasAccount} already have logins`);
  if (noEmail) parts.push(`${noEmail} missing an email (add one in the editor)`);
  const failNote =
    failed.length > 0
      ? ` Failed: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? `; +${failed.length - 3} more` : ""}.`
      : "";
  return { ok: failed.length === 0, message: `${parts.join(", ")}.${failNote}` };
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

/**
 * Merge a duplicate speaker row into the one being kept.
 *
 * A TSLS pull that failed to match created a second row for people who
 * were already here (Matt, 2026-08-11). Deleting the extra row on its own
 * would NOT be safe: sessions.speaker_id and speaker_invites.speaker_id
 * are both `on delete set null`, so a plain delete silently unlinks that
 * speaker's sessions instead of failing. Everything is repointed first.
 *
 * The kept row wins every field it already has — merging only fills its
 * blanks — so admin- and speaker-curated content is never overwritten by
 * a machine-imported duplicate.
 */
export async function mergeSpeakers(
  keepId: string,
  dropId: string,
): Promise<AdminResult> {
  const early = await guard();
  if (early) return early;
  if (!keepId || !dropId || keepId === dropId) {
    return { ok: false, message: "Pick two different speakers to merge." };
  }

  const admin = createServiceClient();
  const { data: rows, error: readErr } = await admin
    .from("speakers")
    .select("*")
    .in("id", [keepId, dropId]);
  if (readErr) return { ok: false, message: readErr.message };
  const keep = (rows ?? []).find((r) => String(r.id) === keepId);
  const drop = (rows ?? []).find((r) => String(r.id) === dropId);
  if (!keep || !drop) {
    return { ok: false, message: "One of those speakers no longer exists." };
  }

  // Fill blanks only.
  const patch: Record<string, unknown> = {};
  const fillable = [
    "title", "bio", "headshot_url", "website", "contact_email",
    "profile_id", "speaker_month",
  ] as const;
  for (const col of fillable) {
    const mine = (keep as Record<string, unknown>)[col];
    const theirs = (drop as Record<string, unknown>)[col];
    if ((mine === null || mine === undefined || mine === "") && theirs) {
      patch[col] = theirs;
    }
  }
  const keepTags = (keep.industries as string[] | null) ?? [];
  const dropTags = (drop.industries as string[] | null) ?? [];
  if (keepTags.length === 0 && dropTags.length > 0) patch.industries = dropTags;
  const keepLinks = (keep.links as Record<string, unknown> | null) ?? {};
  const dropLinks = (drop.links as Record<string, unknown> | null) ?? {};
  if (Object.keys(keepLinks).length === 0 && Object.keys(dropLinks).length > 0) {
    patch.links = dropLinks;
  }
  // Flags are OR-ed: if either row was a TSLS main speaker, the survivor is.
  if (drop.tsls_main_speaker && !keep.tsls_main_speaker) {
    patch.tsls_main_speaker = true;
  }
  if (drop.featured && !keep.featured) patch.featured = true;

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("speakers").update(patch).eq("id", keepId);
    if (error) return { ok: false, message: migrationHint(error.message) };
  }

  // Repoint dependents BEFORE deleting, or the FKs null them out.
  let movedSessions = 0;
  const { data: sess, error: sErr } = await admin
    .from("sessions")
    .update({ speaker_id: keepId })
    .eq("speaker_id", dropId)
    .select("id");
  if (sErr) return { ok: false, message: `Sessions: ${sErr.message}` };
  movedSessions = (sess ?? []).length;

  const { error: iErr } = await admin
    .from("speaker_invites")
    .update({ speaker_id: keepId })
    .eq("speaker_id", dropId);
  // The invites table arrives with 0028; a missing table must not block the
  // merge, but any other failure means something is still pointing at the
  // row we are about to delete.
  if (iErr && !/does not exist|schema cache/i.test(iErr.message)) {
    return { ok: false, message: `Speaker invites: ${iErr.message}` };
  }

  const { error: delErr } = await admin.from("speakers").delete().eq("id", dropId);
  if (delErr) return { ok: false, message: delErr.message };

  refresh();
  const moved =
    movedSessions > 0
      ? ` ${movedSessions} session${movedSessions === 1 ? "" : "s"} moved across.`
      : "";
  return {
    ok: true,
    message: `Merged "${String(drop.name)}" into "${String(keep.name)}".${moved}`,
  };
}

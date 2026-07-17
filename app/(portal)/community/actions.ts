"use server";

import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/*
 * Speaker Q&A routing: when a member posts in #speaker-qa they pick which
 * speaker the question is for. The question itself lives in the chat; this
 * action tells the speaker about it — a platform notification (bell) plus
 * an email — without exposing anyone's contact details.
 */

export async function askSpeakerQuestion(
  speakerId: string,
  question: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!isSupabaseConfigured()) return { ok: true }; // preview: chat-only
  const q = question.trim().slice(0, 2000);
  if (!speakerId || !q) return { ok: false, message: "Missing question." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const { data: asker } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const askerName = (asker?.full_name as string) ?? "A member";

  const admin = createServiceClient();
  const { data: speaker } = await admin
    .from("speakers")
    .select("id, name, profile_id")
    .eq("id", speakerId)
    .maybeSingle();
  if (!speaker) return { ok: false, message: "That speaker wasn't found." };

  const snippet = q.length > 180 ? `${q.slice(0, 177)}…` : q;

  // Platform notification (bell) — only possible when the speaker has an
  // account wired to their profile.
  if (speaker.profile_id) {
    await admin.from("notifications").insert({
      profile_id: speaker.profile_id,
      kind: "speaker_question",
      title: `${askerName} asked you a question in Speaker Q&A`,
      body: snippet,
      link: "/community",
    });

    // Email notification, resolved server-side (GHL contact from their
    // membership row).
    const [{ data: profile }, { data: membership }] = await Promise.all([
      admin
        .from("profiles")
        .select("email")
        .eq("id", speaker.profile_id)
        .maybeSingle(),
      admin
        .from("memberships")
        .select("ghl_contact_id")
        .eq("profile_id", speaker.profile_id)
        .not("ghl_contact_id", "is", null)
        .limit(1)
        .maybeSingle(),
    ]);
    if (profile?.email) {
      const esc = (t: string) =>
        t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const { sendEmailViaGhl } = await import("@/lib/notifications");
      await sendEmailViaGhl({
        contactId: (membership?.ghl_contact_id as string) ?? null,
        email: profile.email as string,
        subject: `[Momentum+] A member asked you a question in Speaker Q&A`,
        html: `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#B8965A;font-weight:bold;">Speaker Q&amp;A</p>
      <p style="margin:0 0 14px;line-height:1.65;"><strong>${esc(askerName)}</strong> asked you a question in the Momentum+ community:</p>
      <blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #B8965A;background:#F8F6F1;line-height:1.6;">${esc(q)}</blockquote>
      <p style="margin:0 0 16px;">
        <a href="https://momentumplus.co/community" style="color:#B8965A;font-weight:bold;">Open Speaker Q&amp;A to reply</a>
      </p>
      <p style="margin:0;font-size:11.5px;color:#9ca3af;">Sent through Momentum+. Replies to this email don't reach the member — answer in the community.</p>
    </div>
  </div>`,
      });
    }
  }

  return { ok: true };
}

/** Mark all of the viewer's notifications read (bell menu opened). */
export async function markNotificationsRead(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  // Own rows only — RLS also enforces this.
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", user.id)
    .is("read_at", null);
}

"use server";

import { revalidatePath } from "next/cache";
import { getAdminAccess, requireAdmin } from "@/lib/auth-helpers";
import { brandedEmailHtml } from "@/lib/email-template";
import { sendEmailViaGhl } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export interface ErrorsResult {
  ok: boolean;
  message?: string;
}

async function guard(): Promise<string | null> {
  const auth = await requireAdmin("members");
  if (!auth.ok) return auth.message;
  const access = await getAdminAccess();
  if (access?.role !== "super") return "Super Admin only.";
  return null;
}

/**
 * "We're on it": email exactly the members who hit this error, plus an
 * in-app bell notice (which lands even if GHL is down). The subject and
 * body come from the composer — prefilled, but the admin sends the words.
 */
export async function notifyAffected(
  hash: string,
  subject: string,
  bodyText: string,
): Promise<ErrorsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Sent (preview mode)." };
  }
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  if (!subject.trim() || !bodyText.trim()) {
    return { ok: false, message: "The email needs a subject and a message." };
  }

  const admin = createServiceClient();
  const { data: hits, error } = await admin
    .from("error_report_hits")
    .select("profile_id")
    .eq("hash", hash);
  if (error) {
    return {
      ok: false,
      message: /error_report_hits/.test(error.message)
        ? "Run 0061_error_hits.sql in Supabase first — affected members are only tracked after it."
        : error.message,
    };
  }
  const ids = (hits ?? []).map((h) => String(h.profile_id));
  if (ids.length === 0) {
    return {
      ok: false,
      message:
        "Nobody is recorded on this error yet. (Members are tracked from the moment migration 0061 ran — earlier occurrences are count-only.)",
    };
  }

  const [{ data: profiles }, { data: contacts }] = await Promise.all([
    admin.from("profiles").select("id, email, full_name").in("id", ids),
    admin
      .from("memberships")
      .select("profile_id, ghl_contact_id")
      .in("profile_id", ids)
      .not("ghl_contact_id", "is", null),
  ]);
  const contactBy = new Map(
    (contacts ?? []).map((c) => [
      String(c.profile_id),
      String(c.ghl_contact_id),
    ]),
  );

  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bodyHtml = bodyText
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.65;">${esc(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");

  let sent = 0;
  for (const p of profiles ?? []) {
    if (!p.email) continue;
    const res = await sendEmailViaGhl({
      contactId: contactBy.get(String(p.id)) ?? null,
      email: String(p.email),
      subject: subject.trim(),
      html: brandedEmailHtml({
        greetingName: String(p.full_name ?? ""),
        heading: subject.trim(),
        bodyHtml,
        footnote:
          "You're receiving this because you ran into an error on Momentum+ — no action is needed on your part.",
      }),
    });
    if (res.sent) sent += 1;
  }

  // Bell notice for everyone affected, regardless of email outcome.
  await admin.from("notifications").insert(
    ids.map((profile_id) => ({
      profile_id,
      kind: "platform",
      title: subject.trim(),
      body: bodyText.trim().slice(0, 160),
      link: "/dashboard",
    })),
  );

  await admin
    .from("error_reports")
    .update({ users_notified_at: new Date().toISOString() })
    .eq("hash", hash);

  revalidatePath("/admin/errors");
  return {
    ok: true,
    message: `Notified ${ids.length} member${ids.length === 1 ? "" : "s"} (${sent} email${sent === 1 ? "" : "s"} sent, the rest bell-only).`,
  };
}

/** Resolved: delete the report (hits cascade with it). */
export async function clearError(hash: string): Promise<ErrorsResult> {
  if (!isSupabaseConfigured()) {
    return { ok: true, message: "Cleared (preview mode)." };
  }
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  const { error } = await createServiceClient()
    .from("error_reports")
    .delete()
    .eq("hash", hash);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/errors");
  return { ok: true, message: "Cleared." };
}

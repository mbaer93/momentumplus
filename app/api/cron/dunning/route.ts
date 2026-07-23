import { bearerAuthorized } from "@/lib/db-utils";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sendEmailViaGhl } from "@/lib/notifications";

/*
 * Failed-payment recovery (dunning). Daily: every membership sitting in
 * past_due gets a short email sequence — immediately, ~day 3, and ~day 6
 * (the grace window is 7 days) — pointing at Profile → billing to fix the
 * card. Each step is journaled in dunning_notices so it sends exactly once
 * per past_due spell; recovery (status back to active) simply stops the
 * sequence, and the journal rows are cleared so a future failure restarts
 * it. Protected by CRON_SECRET.
 */

const STEP_GAP_DAYS = 3;

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";

function emailBody(name: string, step: number): { subject: string; html: string } {
  const urgency =
    step === 1
      ? "Your latest Momentum+ payment didn't go through — usually an expired card or a bank hiccup."
      : step === 2
        ? "Just a reminder: your Momentum+ payment is still unresolved and your access is in its grace window."
        : "Final reminder — your grace window is almost up, and access pauses when it ends.";
  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;">
      <p style="margin:0 0 14px;line-height:1.65;">Hi ${name || "there"},</p>
      <p style="margin:0 0 14px;line-height:1.65;">${urgency}</p>
      <p style="margin:0 0 16px;line-height:1.65;">
        It takes about a minute to fix: open your profile and use
        <strong>Manage billing</strong> to update your card. Your membership,
        progress, and community access all stay exactly as they are.
      </p>
      <p style="margin:0 0 16px;">
        <a href="${SITE}/profile" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;padding:10px 18px;border-radius:4px;text-decoration:none;">Update payment method</a>
      </p>
      <p style="margin:0;font-size:11.5px;color:#9ca3af;">
        Already fixed it? You can ignore this. Questions — just reply, a real
        person reads these.
      </p>
    </div>
  </div>`;
  return {
    subject:
      step === 3
        ? "[Momentum+] Final reminder: update your payment method"
        : "[Momentum+] Your payment needs attention",
    html,
  };
}

// Long-running under load — allow the full function window (Vercel Pro).
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!bearerAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const admin = createServiceClient();

  // Recovered members: clear their journal so a future failure re-arms
  // the sequence from step 1.
  const { data: recovered } = await admin
    .from("memberships")
    .select("id, dunning_notices ( membership_id )")
    .eq("status", "active")
    .not("dunning_notices", "is", null);
  const recoveredIds = (recovered ?? [])
    .filter(
      (m) =>
        Array.isArray((m as { dunning_notices?: unknown[] }).dunning_notices) &&
        ((m as { dunning_notices?: unknown[] }).dunning_notices?.length ?? 0) > 0,
    )
    .map((m) => m.id as string);
  if (recoveredIds.length > 0) {
    await admin.from("dunning_notices").delete().in("membership_id", recoveredIds);
  }

  const { data: pastDue, error } = await admin
    .from("memberships")
    .select(
      "id, profile_id, ghl_contact_id, profiles ( email, full_name ), dunning_notices ( step, sent_at )",
    )
    .eq("status", "past_due");
  if (error) {
    // Pre-migration (0034): the join fails until dunning_notices exists.
    return NextResponse.json({
      ok: false,
      note: `Waiting on migration 0034: ${error.message}`,
    });
  }

  const now = Date.now();
  let sent = 0;
  const results: { membershipId: string; step: number }[] = [];

  for (const m of pastDue ?? []) {
    const profile = (
      m as unknown as { profiles: { email: string | null; full_name: string | null } | null }
    ).profiles;
    if (!profile?.email) continue;

    const notices = (
      (m as unknown as { dunning_notices: { step: number; sent_at: string }[] })
        .dunning_notices ?? []
    ).sort((a, b) => a.step - b.step);
    const lastStep = notices[notices.length - 1] ?? null;

    let nextStep: number | null = null;
    if (!lastStep) nextStep = 1;
    else if (
      lastStep.step < 3 &&
      now - new Date(lastStep.sent_at).getTime() >=
        STEP_GAP_DAYS * 24 * 60 * 60 * 1000
    ) {
      nextStep = lastStep.step + 1;
    }
    if (nextStep === null) continue;

    const { subject, html } = emailBody(profile.full_name ?? "", nextStep);
    const res = await sendEmailViaGhl({
      contactId: (m.ghl_contact_id as string) ?? null,
      email: profile.email,
      subject,
      html,
    });

    // Journal even when GHL couldn't deliver (no contact id) — the in-app
    // notice below still lands, and re-sending the same step daily would
    // spam members the moment GHL connects.
    await admin.from("dunning_notices").upsert(
      { membership_id: m.id, step: nextStep },
      { onConflict: "membership_id,step" },
    );
    await admin.from("notifications").insert({
      profile_id: m.profile_id,
      kind: "platform",
      title: "Your payment needs attention",
      body: "Update your card under Manage billing to keep your access.",
      link: "/profile",
    });
    if (res.sent) sent += 1;
    results.push({ membershipId: m.id as string, step: nextStep });
  }

  return NextResponse.json({
    ok: true,
    pastDue: pastDue?.length ?? 0,
    stepsSent: results.length,
    emailsDelivered: sent,
    journalCleared: recoveredIds.length,
  });
}

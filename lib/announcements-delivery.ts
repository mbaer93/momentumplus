/*
 * Announcement delivery fan-out — community post, in-app + push, email, SMS.
 *
 * Extracted from the admin send action (Matt, 2026-08-05: announcements can
 * now be scheduled) so the same delivery runs from two callers:
 *   - the Announcements composer's "Send now" (server action, admin-gated)
 *   - the scheduled-posts cron, when a scheduled announcement comes due
 *
 * NOT a "use server" file — nothing here may be client-invokable. Callers
 * are responsible for authorization (requireAdmin / CRON_SECRET).
 *
 * Everything is journaled per member in announcement_deliveries (and
 * community_posted_at on the announcement row), so a run that dies partway —
 * timeout, deploy, budget stop — resumes safely: members already reached are
 * skipped, never messaged twice.
 */

import { allRows } from "@/lib/db-utils";
import { createServiceClient } from "@/lib/supabase/admin";
import { brandedEmailHtml } from "@/lib/email-template";
import { sendEmailViaGhl, sendSmsViaGhl } from "@/lib/notifications";
import { sendPushToProfiles } from "@/lib/push";

export interface DeliveryResult {
  ok: boolean;
  message: string;
  recipients: number;
  /** True when every owed delivery was attempted this run (no time-budget
      leftovers). Per-member failures don't clear this — the ledger lets a
      manual resend retry just those. */
  complete: boolean;
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string | null;
  audience_tiers: string[];
  channels: string[];
  community_posted_at: string | null;
}

/** Run the full fan-out for a recorded announcement. Idempotent per member. */
export async function deliverAnnouncement(
  announcementId: string,
): Promise<DeliveryResult> {
  const admin = createServiceClient();
  const { data: annData, error: annError } = await admin
    .from("announcements")
    .select("id, title, body, audience_tiers, channels, community_posted_at")
    .eq("id", announcementId)
    .maybeSingle();
  if (annError || !annData) {
    return {
      ok: false,
      complete: false,
      recipients: 0,
      message: annError?.message ?? "Announcement not found.",
    };
  }
  const ann = annData as AnnouncementRow;
  const title = ann.title.trim();
  const body = (ann.body ?? "").trim();
  const channels = ann.channels ?? [];
  const audienceTiers = ann.audience_tiers ?? [];

  // Community post: into the #announcements chat channel as the team user.
  // Journaled on the announcement row (community_posted_at, migration 0038)
  // so retrying a partially-failed send can't post to chat twice.
  let communityNote = "";
  if (channels.includes("community")) {
    if (ann.community_posted_at) {
      communityNote = " Already posted to #announcements on the earlier run.";
    } else {
      try {
        const { sendCommunityMessage } = await import("@/lib/stream");
        await sendCommunityMessage(
          "announcements",
          `${title}${body ? `\n\n${body}` : ""}`,
        );
        communityNote = " Posted to #announcements.";
        // Best-effort journal — fails only pre-migration-0038, where retry
        // behavior simply matches the old (repost) behavior.
        await admin
          .from("announcements")
          .update({ community_posted_at: new Date().toISOString() })
          .eq("id", announcementId);
      } catch (e) {
        communityNote = ` Community post failed (${(e as Error).message}) — send it again with only the Community channel selected to retry.`;
      }
    }
  }
  if (audienceTiers.length === 0) {
    return {
      ok: !communityNote.includes("failed"),
      complete: true,
      recipients: 0,
      message: communityNote.trim() || "Nothing sent.",
    };
  }

  // Audience: members holding a usable membership in the selected tiers.
  // Paged — a plain select silently stops at 1000 members.
  const { rows: memberships } = await allRows<{
    profile_id: string;
    ghl_contact_id: string | null;
    profiles: { email: string; full_name: string; phone: string | null } | null;
  }>((from, to) =>
    admin
      .from("memberships")
      .select("profile_id, ghl_contact_id, profiles ( email, full_name, phone )")
      .in("tier", audienceTiers)
      .in("status", ["active", "past_due"])
      .order("profile_id")
      .range(from, to) as unknown as PromiseLike<{
      data:
        | {
            profile_id: string;
            ghl_contact_id: string | null;
            profiles: {
              email: string;
              full_name: string;
              phone: string | null;
            } | null;
          }[]
        | null;
      error: { message: string } | null;
    }>,
  );

  const seen = new Set<string>();
  const audience: {
    profileId: string;
    contactId: string | null;
    email: string;
    name: string;
    phone: string | null;
  }[] = [];
  for (const m of memberships) {
    if (seen.has(m.profile_id)) continue;
    seen.add(m.profile_id);
    if (!m.profiles) continue;
    audience.push({
      profileId: m.profile_id,
      contactId: m.ghl_contact_id ?? null,
      email: m.profiles.email,
      name: m.profiles.full_name,
      phone: m.profiles.phone ?? null,
    });
  }
  const profileIds = audience.map((a) => a.profileId);

  // What already went out (retry safety). Pre-migration the table may not
  // exist — treat as "nothing delivered yet" and skip journaling.
  let delivered = new Map<
    string,
    { notified: boolean; emailed: boolean; smsed: boolean }
  >();
  let ledgerAvailable = true;
  // sms_at is migration 0048 — select it separately so a pre-0048 database
  // only degrades SMS dedupe, not the whole ledger.
  let smsLedgerAvailable = true;
  {
    const { rows, error } = await allRows<{
      profile_id: string;
      notified_at: string | null;
      emailed_at: string | null;
    }>((from, to) =>
      admin
        .from("announcement_deliveries")
        .select("profile_id, notified_at, emailed_at")
        .eq("announcement_id", announcementId)
        .order("profile_id")
        .range(from, to),
    );
    if (error) {
      ledgerAvailable = false;
      smsLedgerAvailable = false;
    } else {
      delivered = new Map(
        rows.map((r) => [
          r.profile_id,
          {
            notified: Boolean(r.notified_at),
            emailed: Boolean(r.emailed_at),
            smsed: false,
          },
        ]),
      );
      if (channels.includes("sms")) {
        const { rows: smsRows, error: smsError } = await allRows<{
          profile_id: string;
          sms_at: string | null;
        }>((from, to) =>
          admin
            .from("announcement_deliveries")
            .select("profile_id, sms_at")
            .eq("announcement_id", announcementId)
            .order("profile_id")
            .range(from, to),
        );
        if (smsError) {
          smsLedgerAvailable = false;
        } else {
          for (const r of smsRows) {
            if (!r.sms_at) continue;
            const entry = delivered.get(r.profile_id);
            if (entry) entry.smsed = true;
          }
        }
      }
    }
  }

  // Platform prefs in ONE paged query, filtered against the audience in
  // memory (a giant .in(profileIds) both overflows the URL and caps at
  // 1000 returned rows).
  const optedOut = new Set<string>();
  if (channels.includes("in_app") && profileIds.length > 0) {
    const audienceIds = new Set(profileIds);
    const { rows: prefs } = await allRows<{
      profile_id: string;
      in_app: boolean | null;
    }>((from, to) =>
      admin
        .from("notification_prefs")
        .select("profile_id, in_app")
        .eq("key", "platform")
        .order("profile_id")
        .range(from, to),
    );
    for (const p of prefs) {
      if (p.in_app === false && audienceIds.has(p.profile_id)) {
        optedOut.add(p.profile_id);
      }
    }
  }

  // SMS opt-in: ONLY members who turned on announcement texts (prefs key
  // "announcements") — never the whole audience. Same paged in-memory
  // filter as above.
  const smsOptIn = new Set<string>();
  if (channels.includes("sms") && profileIds.length > 0) {
    const audienceIds = new Set(profileIds);
    const { rows: smsPrefs } = await allRows<{ profile_id: string }>(
      (from, to) =>
        admin
          .from("notification_prefs")
          .select("profile_id")
          .eq("key", "announcements")
          .eq("sms", true)
          .order("profile_id")
          .range(from, to),
    );
    for (const p of smsPrefs) {
      if (audienceIds.has(p.profile_id)) smsOptIn.add(p.profile_id);
    }
  }

  // In-app rows: bulk inserts in bounded chunks for everyone still owed one.
  if (channels.includes("in_app")) {
    const owed = audience.filter(
      (a) => !optedOut.has(a.profileId) && !delivered.get(a.profileId)?.notified,
    );
    const CHUNK = 500;
    for (let i = 0; i < owed.length; i += CHUNK) {
      const chunk = owed.slice(i, i + CHUNK);
      await admin.from("notifications").insert(
        chunk.map((a) => ({
          profile_id: a.profileId,
          kind: "announcement",
          title,
          body: body || null,
          link: "/dashboard",
        })),
      );
      if (ledgerAvailable) {
        await admin.from("announcement_deliveries").upsert(
          chunk.map((a) => ({
            announcement_id: announcementId,
            profile_id: a.profileId,
            notified_at: new Date().toISOString(),
          })),
          { onConflict: "announcement_id,profile_id" },
        );
      }
    }
    // Push mirrors the in-app bell: same audience, same content, delivered
    // to whatever devices those members enabled push on. Best-effort — the
    // ledger's notified_at also covers push, so a resume doesn't re-push.
    try {
      await sendPushToProfiles(
        owed.map((a) => a.profileId),
        {
          title,
          body: body.slice(0, 180),
          link: "/dashboard",
        },
      );
    } catch {
      /* push must never fail the announcement */
    }
  }

  // Emails: bounded-concurrency waves (audit P2-18 — sequential sends
  // capped a run at ~700-900 members; 6 in flight lifts the ceiling ~6×
  // while staying under GHL burst limits, and retryOn429 absorbs the rest).
  // The ledger is journaled once per WAVE instead of once per member: a
  // mid-wave crash can re-email at most one wave on resume, which is the
  // price of ~6× fewer ledger round-trips. TIME-BUDGETED: the loop stops
  // cleanly at the budget — the ledger makes the next run (another Send
  // press, or the next cron tick) resume-only.
  const SEND_CONCURRENCY = 6;
  let emailed = 0;
  let emailFailures = 0;
  let lastEmailError: string | null = null;
  let remainingForBudget = 0;
  // ONE budget shared by the email and SMS loops — together they must fit
  // the function limit; the ledger lets a second run finish the rest.
  const emailBudgetStart = Date.now();
  const EMAIL_BUDGET_MS = 240_000;
  if (channels.includes("email")) {
    const pending = audience.filter((a) => !delivered.get(a.profileId)?.emailed);
    for (let i = 0; i < pending.length; i += SEND_CONCURRENCY) {
      if (Date.now() - emailBudgetStart > EMAIL_BUDGET_MS) {
        remainingForBudget += pending.length - i;
        break;
      }
      const wave = pending.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.all(
        wave.map((a) =>
          sendEmailViaGhl({
            contactId: a.contactId,
            email: a.email,
            subject: title,
            html: brandedEmailHtml({
              greetingName: a.name,
              heading: title,
              bodyHtml: `<p style="margin:0 0 14px;">${body.replace(/\n/g, "<br/>")}</p>`,
              ctaLabel: "Open Momentum+",
              ctaUrl: "/dashboard",
              footnote:
                "You're receiving this as a Momentum+ member of the Tri-State Leadership Summit community.",
            }),
          }),
        ),
      );
      const sentRows: {
        announcement_id: string;
        profile_id: string;
        emailed_at: string;
      }[] = [];
      results.forEach((res, j) => {
        const a = wave[j];
        if (res.sent) {
          emailed++;
          sentRows.push({
            announcement_id: announcementId,
            profile_id: a.profileId,
            emailed_at: new Date().toISOString(),
          });
        } else if (
          res.reason !== "no GHL contact id" &&
          res.reason !== "GHL not configured"
        ) {
          emailFailures++;
          lastEmailError = res.reason ?? null;
        }
      });
      if (ledgerAvailable && sentRows.length > 0) {
        // On conflict only the provided columns update — notified_at stays.
        await admin
          .from("announcement_deliveries")
          .upsert(sentRows, { onConflict: "announcement_id,profile_id" });
      }
    }
  }

  // Texts: opted-in members with a phone number only. Same wave-concurrent,
  // wave-journaled, budget-bounded shape as email.
  let smsSent = 0;
  let smsFailures = 0;
  let lastSmsError: string | null = null;
  let smsRemainingForBudget = 0;
  let smsEligible = 0;
  if (channels.includes("sms")) {
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";
    const smsMessage = `Momentum+: ${title} — read it here: ${site}/dashboard`;
    const eligible = audience.filter(
      (a) => smsOptIn.has(a.profileId) && a.phone,
    );
    smsEligible = eligible.length;
    const pending = eligible.filter((a) => !delivered.get(a.profileId)?.smsed);
    for (let i = 0; i < pending.length; i += SEND_CONCURRENCY) {
      if (Date.now() - emailBudgetStart > EMAIL_BUDGET_MS) {
        smsRemainingForBudget += pending.length - i;
        break;
      }
      const wave = pending.slice(i, i + SEND_CONCURRENCY);
      const results = await Promise.all(
        wave.map((a) =>
          sendSmsViaGhl({
            contactId: a.contactId,
            email: a.email,
            phone: a.phone,
            message: smsMessage,
          }),
        ),
      );
      const sentRows: {
        announcement_id: string;
        profile_id: string;
        sms_at: string;
      }[] = [];
      results.forEach((res, j) => {
        const a = wave[j];
        if (res.sent) {
          smsSent++;
          sentRows.push({
            announcement_id: announcementId,
            profile_id: a.profileId,
            sms_at: new Date().toISOString(),
          });
        } else if (res.reason !== "GHL not configured") {
          // "no contact/phone" counts too — the sender upserts the GHL
          // contact itself, so any non-send here is a real, fixable failure.
          smsFailures++;
          lastSmsError = res.reason ?? null;
        }
      });
      if (ledgerAvailable && smsLedgerAvailable && sentRows.length > 0) {
        await admin
          .from("announcement_deliveries")
          .upsert(sentRows, { onConflict: "announcement_id,profile_id" });
      }
    }
  }

  const parts: string[] = [`Reached ${audience.length} member${audience.length === 1 ? "" : "s"}.`];
  if (channels.includes("email")) {
    parts.push(`${emailed} email${emailed === 1 ? "" : "s"} sent this run.`);
    if (remainingForBudget > 0) {
      parts.push(
        ledgerAvailable
          ? `${remainingForBudget} still to email — press Send again to continue (members already reached are skipped automatically).`
          : `${remainingForBudget} still to email, but retry-dedupe is unavailable (migration 0031) — pressing Send again MAY re-email members already reached.`,
      );
    }
    if (emailFailures > 0) {
      parts.push(
        ledgerAvailable
          ? `${emailFailures} email${emailFailures === 1 ? "" : "s"} failed${lastEmailError ? ` (last error: ${lastEmailError})` : ""} — press Send again to retry just those (no one gets duplicates).`
          : `${emailFailures} email${emailFailures === 1 ? "" : "s"} failed${lastEmailError ? ` (last error: ${lastEmailError})` : ""}. Retry-dedupe is unavailable (migration 0031 hasn't run), so pressing Send again MAY re-email members already reached.`,
      );
    }
  }
  if (channels.includes("sms")) {
    parts.push(
      `${smsSent} text${smsSent === 1 ? "" : "s"} sent (${smsEligible} member${smsEligible === 1 ? "" : "s"} opted in with a phone number).`,
    );
    if (smsRemainingForBudget > 0) {
      parts.push(
        smsLedgerAvailable
          ? `${smsRemainingForBudget} still to text — press Send again to continue.`
          : `${smsRemainingForBudget} still to text, but SMS retry-dedupe is unavailable (migration 0048) — pressing Send again MAY re-text members already reached.`,
      );
    }
    if (smsFailures > 0) {
      parts.push(
        smsLedgerAvailable
          ? `${smsFailures} text${smsFailures === 1 ? "" : "s"} failed${lastSmsError ? ` (last error: ${lastSmsError})` : ""} — press Send again to retry just those.`
          : `${smsFailures} text${smsFailures === 1 ? "" : "s"} failed${lastSmsError ? ` (last error: ${lastSmsError})` : ""}. SMS retry-dedupe is unavailable (migration 0048 hasn't run), so pressing Send again MAY re-text members already reached.`,
      );
    }
  }
  if (communityNote) parts.push(communityNote.trim());
  return {
    ok: emailFailures === 0 && smsFailures === 0 && !communityNote.includes("failed"),
    complete: remainingForBudget === 0 && smsRemainingForBudget === 0,
    recipients: audience.length,
    message: parts.join(" "),
  };
}

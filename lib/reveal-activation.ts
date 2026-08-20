import { redactEmail } from "@/lib/db-utils";
import { sendEmailViaGhl } from "@/lib/notifications";
import {
  activateScheduledGift,
  mintWelcomeLink,
  type ScheduledGiftRow,
} from "@/lib/onboarding";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  activationEmailHtml,
  activationEmailSubject,
} from "@/lib/tsls-activation-email";

/*
 * Activating ONE parked guest — the shared body of the reveal.
 *
 * Extracted so the on-stage press (/api/bridge/reveal) and the admin
 * rehearsal button run the same code (Matt, 2026-08-20). A rehearsal that
 * exercised a second implementation would prove nothing about the thing it
 * is rehearsing, which is the entire point of rehearsing.
 */

export interface RevealOneResult {
  ok: boolean;
  /** The grant landed. */
  activated: boolean;
  /** The activation email went out. Separate from `activated` on purpose. */
  emailed: boolean;
  /** Redacted — this ends up in logs and admin screens, not a support ticket. */
  detail: string;
}

export async function revealOneGuest(
  row: ScheduledGiftRow,
  startsAtIso: string,
): Promise<RevealOneResult> {
  const admin = createServiceClient();
  const who = redactEmail(String(row.email));

  const res = await activateScheduledGift({ ...row, starts_at: startsAtIso }).catch(
    (e) => ({ ok: false, result: (e as Error).message || "threw" }),
  );

  if (!res.ok) {
    // Left unstamped so the cron retries and a second press picks it up.
    await admin
      .from("scheduled_gifts")
      .update({ result: `retrying: ${res.result}` })
      .eq("id", row.id);
    return { ok: false, activated: false, emailed: false, detail: `${who}: ${res.result}` };
  }

  await admin
    .from("scheduled_gifts")
    .update({ applied_at: new Date().toISOString(), result: res.result })
    .eq("id", row.id);

  /*
   * The email is best-effort and deliberately AFTER the stamp. If GHL is
   * throttling, the access is still real and the invite can be re-sent from
   * Admin → Members — whereas retrying the row to get an email out would
   * risk a second grant. Access first, announcement second.
   *
   * So `emailed` is reported separately from `activated`: a guest whose
   * grant landed but whose email did not has access and does not know it,
   * which is the one outcome that looks fine in the database and isn't.
   */
  try {
    const link = await mintWelcomeLink(String(row.email));
    const sent = await sendEmailViaGhl({
      email: String(row.email),
      subject: activationEmailSubject(),
      html: activationEmailHtml({
        name: row.name,
        tier: row.tier,
        months: Number(row.months),
        loginUrl: link,
      }),
    });
    return sent.sent
      ? { ok: true, activated: true, emailed: true, detail: `${who}: activated and emailed` }
      : {
          ok: true,
          activated: true,
          emailed: false,
          detail: `${who}: activated, but the email did not send (${sent.reason})`,
        };
  } catch (e) {
    return {
      ok: true,
      activated: true,
      emailed: false,
      detail: `${who}: activated, but the email threw (${e instanceof Error ? e.message : "unknown"})`,
    };
  }
}

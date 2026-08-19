import { brandedEmailHtml } from "@/lib/email-template";
import type { Tier } from "@/lib/types";

/*
 * The email a TSLS guest gets the moment the reveal is pressed at the event
 * (Matt, 2026-08-19).
 *
 * This is the FIRST thing Momentum+ ever sends them. Their account was
 * created silently when they bought their ticket — deliberately, so nothing
 * spoiled the reveal — which means this arrives with no prior context. It
 * cannot read as a reminder or a receipt. It has to explain what they now
 * have, that it is already paid for, and how to get in.
 *
 * They have no password. The account was provisioned quietly, so the link is
 * a one-time sign-in that lands them on /welcome to set one. Nothing here
 * asks them to "log in" as though they had credentials they were given.
 *
 * DRAFT — member-facing copy is Matt's call (CLAUDE.md "When unsure").
 */

export interface ActivationEmailInput {
  name?: string | null;
  tier: Tier;
  months: number;
  /** One-time sign-in URL landing on /welcome. Omitted → plain CTA. */
  loginUrl?: string | null;
}

/** "3 months" / "1 month" — the length they were actually granted. */
function monthsLabel(months: number): string {
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function activationEmailSubject(): string {
  return "Your Momentum+ access is open";
}

export function activationEmailHtml(input: ActivationEmailInput): string {
  const length = monthsLabel(input.months);
  const isVip = input.tier === "tsls_vip";

  /*
   * The value is named because it is real and because it frames what comes
   * after the free window — a member who never knew the access was worth
   * anything reads the eventual renewal as a surprise charge. SPEC §2: VIP
   * embeds 3 months ($534), General Admission 1 month ($198).
   */
  const value = isVip ? "$534" : "$198";

  const bodyHtml = `
    <p style="margin:0 0 14px;">
      Your ticket to the Tri-State Leadership Summit included
      <strong>${length} of Momentum+</strong> &mdash; and it is open now.
    </p>
    <p style="margin:0 0 14px;">
      Momentum+ is where the Summit keeps going: live sessions with the
      speakers you heard today, every session recorded and summarised, a
      community of the people in the room with you, and the resources they
      referenced. Yours is already paid for as part of your
      ${isVip ? "VIP registration" : "registration"} &mdash; a ${value} value,
      with nothing to enter and no card required.
    </p>
    <p style="margin:0 0 14px;">
      The button below signs you in and asks you to choose a password. It
      works once, so open it on the device you want to use.
    </p>`;

  return brandedEmailHtml({
    greetingName: input.name?.trim() || "",
    heading: "Your Momentum+ access is open",
    bodyHtml,
    ctaLabel: "Open Momentum+",
    ctaUrl: input.loginUrl || "/login",
    footnote:
      `You're receiving this because your Tri-State Leadership Summit ticket ` +
      `included ${length} of Momentum+. Your ${length} begins today.`,
  });
}

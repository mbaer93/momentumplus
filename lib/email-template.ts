/*
 * Shared Momentum+ email shell — the same navy-header/gold-wordmark card
 * the dunning and invite emails established (SPEC.md design tokens: navy
 * #0B1622, gold #B8965A, cream #F8F6F1, serif headings). Inline styles
 * only: email clients ignore stylesheets.
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://momentumplus.co";

export function brandedEmailHtml(input: {
  /** First line: "Hi {name}," — pass "" to skip the greeting. */
  greetingName?: string;
  /** Optional serif heading shown above the body. */
  heading?: string;
  /** Body paragraphs, already HTML (caller escapes/handles member input). */
  bodyHtml: string;
  /** Optional gold CTA button. */
  ctaLabel?: string;
  /** CTA target — absolute, or a site-relative path like /sessions/abc. */
  ctaUrl?: string;
  /** Small gray line under the body (e.g. why they got this). */
  footnote?: string;
}): string {
  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<p style="margin:0 0 16px;">
          <a href="${input.ctaUrl.startsWith("http") ? input.ctaUrl : `${SITE}${input.ctaUrl}`}" style="display:inline-block;background:#B8965A;color:#0B1622;font-weight:bold;padding:10px 18px;border-radius:4px;text-decoration:none;">${input.ctaLabel}</a>
        </p>`
      : "";
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2332;">
    <div style="background:#0B1622;padding:18px 22px;border-radius:4px 4px 0 0;">
      <span style="font-family:Georgia,serif;font-size:20px;color:#F8F6F1;">Momentum<span style="color:#B8965A;">+</span></span>
    </div>
    <div style="border:1px solid #E8E4DC;border-top:none;padding:22px;border-radius:0 0 4px 4px;background:#ffffff;">
      ${input.heading ? `<h2 style="font-family:Georgia,serif;font-size:19px;font-weight:normal;color:#0B1622;margin:0 0 14px;">${input.heading}</h2>` : ""}
      ${input.greetingName === "" ? "" : `<p style="margin:0 0 14px;line-height:1.65;">Hi ${input.greetingName || "there"},</p>`}
      <div style="line-height:1.65;">${input.bodyHtml}</div>
      ${cta}
      ${input.footnote ? `<p style="margin:14px 0 0;font-size:11.5px;color:#9ca3af;">${input.footnote}</p>` : ""}
    </div>
    <p style="text-align:center;font-size:11px;color:#9ca3af;margin:14px 0 0;">
      Momentum+ &middot; Tri-State Leadership Summit &middot; Sierra Learnership Collaborative
    </p>
  </div>`;
}

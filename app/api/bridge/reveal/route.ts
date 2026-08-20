import { NextResponse, type NextRequest } from "next/server";
import {
  bridgeAuthorized,
  revealAuthorized,
  revealKeyConfigured,
} from "@/lib/bridge-auth";
import { redactEmail } from "@/lib/db-utils";
import { sendEmailViaGhl } from "@/lib/notifications";
import {
  activateScheduledGift,
  mintWelcomeLink,
  type ScheduledGiftRow,
} from "@/lib/onboarding";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  activationEmailHtml,
  activationEmailSubject,
} from "@/lib/tsls-activation-email";

/*
 * The reveal (Matt, 2026-08-19: "Activation should be based on when I click a
 * go live or reveal button in the TSLS app").
 *
 * TSLS pushes every guest to Momentum+ as they register — quietly. The
 * account exists, nothing has been sent, and there is no active membership,
 * so there is nothing to find and nothing to spoil. This endpoint is the
 * moment that changes: pressed from the stage, it activates every waiting
 * grant and sends each guest the first email Momentum+ has ever sent them.
 *
 *   POST /api/bridge/reveal
 *   Header: x-api-key: <MOMENTUM_REVEAL_KEY>   to activate for real
 *           x-api-key: <either key>            for { "dryRun": true }
 *   Body:   {} — or { "dryRun": true } to see who WOULD be activated
 *   → 200 { ok, activated, emailed, remaining, failures }
 *
 * The dedicated secret is TSLS's security review (2026-08-19), and their
 * framing was right: the provisioning key runs in a sync loop all day, while
 * this one is used once, ever. Sharing them meant a single leaked env var
 * could activate every grant and email every guest at the wrong moment —
 * and you cannot un-send 77 emails or un-spoil a reveal.
 *
 * Three things this has to get right, because it runs once, live, in front
 * of a room:
 *
 * 1. THE CLOCK STARTS NOW. Grants were scheduled against the first of the
 *    event month, and activateScheduledGift deliberately anchors on the
 *    scheduled date so a late cron cannot run a gift long. Here that would
 *    be backwards — a guest revealed on the 14th would silently lose the
 *    first two weeks of a one-month grant. So starts_at is moved to now
 *    before activating.
 *
 * 2. PRESSING IT TWICE MUST BE SAFE. Nobody on a stage is sure the first
 *    press worked. Activation is keyed on scheduled_gifts.applied_at, so an
 *    already-activated guest is invisible to the second run: no second
 *    grant, no second email.
 *
 * 3. IT CANNOT FINISH IN ONE REQUEST. Each activation is a serial chain and
 *    a full room is hundreds of them, past any function window. So it drains
 *    what it can inside a time budget and reports `remaining`; the
 *    gift-activate cron picks up the rest, and pressing again is safe and
 *    resumes. Every row it could not reach is still marked due, so nobody is
 *    left behind by stopping early.
 */

export const maxDuration = 300;
const TIME_BUDGET_MS = 240_000;
const BATCH = 200;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  const dryRun = body.dryRun === true;

  /*
   * Two doors, because the two actions carry completely different risk.
   *
   * A dry run writes nothing and takes either key — TSLS has to be able to
   * verify its wiring and read the count without holding the once-ever
   * secret, which is the whole reason the secrets are separate.
   *
   * A real activation takes MOMENTUM_REVEAL_KEY and nothing else. The
   * provisioning key runs in a sync loop all day; this one is used once.
   * Accepting the provisioning key here as a "fallback" would be the shared
   * -key problem with extra steps, so there isn't one.
   */
  if (dryRun) {
    if (!bridgeAuthorized(req) && !revealAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    if (!revealKeyConfigured()) {
      // Distinguished from a wrong key on purpose: at 9am on event day
      // "you sent the wrong secret" and "nobody ever set this up" need
      // different people doing different things.
      return NextResponse.json(
        {
          error:
            "MOMENTUM_REVEAL_KEY is not set on Momentum+. The reveal needs its own secret — set it in Vercel (Production) and give TSLS the same value.",
        },
        { status: 503 },
      );
    }
    if (!revealAuthorized(req)) {
      return NextResponse.json(
        {
          error:
            "Unauthorized — a real activation needs MOMENTUM_REVEAL_KEY, not the provisioning key. Use dryRun to check wiring with either.",
        },
        { status: 401 },
      );
    }
  }

  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const startedAt = Date.now();
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: pending, error } = await admin
    .from("scheduled_gifts")
    .select("id, profile_id, email, name, tier, months, starts_at, source")
    .is("applied_at", null)
    .order("starts_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return NextResponse.json(
      {
        error: /relation .*scheduled_gifts.* does not exist/i.test(error.message)
          ? "Run migration 0068 first."
          : error.message,
      },
      { status: 500 },
    );
  }

  const rows = pending ?? [];
  const { count: totalPending } = await admin
    .from("scheduled_gifts")
    .select("id", { count: "exact", head: true })
    .is("applied_at", null);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldActivate: totalPending ?? rows.length,
      sample: rows.slice(0, 5).map((r) => ({
        email: redactEmail(String(r.email)),
        tier: r.tier,
        months: r.months,
      })),
    });
  }

  /*
   * Move the clock before activating, not after. activateScheduledGift
   * anchors the grant on starts_at, so leaving a September date in place
   * would hand a one-month guest a membership that had already half
   * expired by the time they read the email.
   */
  await admin
    .from("scheduled_gifts")
    .update({ starts_at: nowIso })
    .is("applied_at", null);

  let activated = 0;
  let emailed = 0;
  let remaining = 0;
  const failures: string[] = [];

  for (const row of rows) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      remaining++;
      continue;
    }

    const res = await activateScheduledGift({
      ...(row as unknown as ScheduledGiftRow),
      starts_at: nowIso,
    }).catch((e) => ({ ok: false, result: (e as Error).message || "threw" }));

    if (!res.ok) {
      // Leave unstamped so the cron retries and a second press picks it up.
      await admin
        .from("scheduled_gifts")
        .update({ result: `retrying: ${res.result}` })
        .eq("id", row.id);
      failures.push(`${redactEmail(String(row.email))}: ${res.result}`);
      continue;
    }

    await admin
      .from("scheduled_gifts")
      .update({ applied_at: new Date().toISOString(), result: res.result })
      .eq("id", row.id);
    activated++;

    /*
     * The email is best-effort and deliberately AFTER the stamp. If GHL is
     * throttling, the access is still real and the invite can be re-sent
     * from Admin → Members — whereas retrying the whole row to get an email
     * out would risk a second grant. Access first, announcement second.
     */
    try {
      const link = await mintWelcomeLink(String(row.email));
      const sent = await sendEmailViaGhl({
        email: String(row.email),
        subject: activationEmailSubject(),
        html: activationEmailHtml({
          name: row.name as string | null,
          tier: row.tier as ScheduledGiftRow["tier"],
          months: Number(row.months),
          loginUrl: link,
        }),
      });
      if (sent.sent) emailed++;
      else failures.push(`${redactEmail(String(row.email))}: email ${sent.reason}`);
    } catch (e) {
      failures.push(
        `${redactEmail(String(row.email))}: email ${(e as Error).message}`,
      );
    }
  }

  const stillPending = Math.max(0, (totalPending ?? 0) - activated);

  return NextResponse.json({
    ok: true,
    activated,
    emailed,
    // Named separately from `activated`: a guest whose grant landed but whose
    // email didn't has access and doesn't know it, which is the one outcome
    // that looks fine from the database and isn't.
    remaining: stillPending + remaining,
    failures,
  });
}

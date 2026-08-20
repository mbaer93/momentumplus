import { NextResponse, type NextRequest } from "next/server";
import {
  bridgeAuthorized,
  revealAuthorized,
  revealKeyConfigured,
} from "@/lib/bridge-auth";
import { redactEmail } from "@/lib/db-utils";
import { rateLimited } from "@/lib/rate-limit";
import { type ScheduledGiftRow } from "@/lib/onboarding";
import { revealOneGuest } from "@/lib/reveal-activation";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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
  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: unknown;
    onlyEmail?: unknown;
  };
  const dryRun = body.dryRun === true;

  /*
   * Rehearse the reveal on ONE person (Matt, 2026-08-20).
   *
   * Until this existed the reveal could not be tested at all: firing it
   * activated every parked row, so the only way to prove the chain worked
   * was to spoil it for all 74 guests. Which meant the first real execution
   * would have been on stage, in front of a room, on a path nobody had ever
   * run — activation → membership → GHL email → one-time link → /welcome →
   * password → portal. Any link in that could fail in a way a unit test
   * cannot see: GHL throttling at 74 sends, the token_hash landing wrong,
   * the email rendering badly in Outlook.
   *
   * With onlyEmail, one parked guest can be walked end to end weeks early
   * and everybody else stays parked. The press on stage is then the second
   * time it has run, not the first.
   *
   * It narrows what is touched; it never widens it. Same key, same
   * ceilings, same idempotency — an already-activated row is still
   * invisible, so a rehearsal cannot double-grant or double-email.
   */
  const onlyEmail =
    typeof body.onlyEmail === "string" && body.onlyEmail.trim()
      ? body.onlyEmail.trim().toLowerCase()
      : null;

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

  /*
   * Inbound ceiling, below BOTH doors so a dry run cannot be used to exhaust
   * the budget a real activation needs. Placed after the key checks, so an
   * unauthorized caller never spends it either.
   *
   * 10/minute still allows every retry a real reveal needs — draining the
   * remainder, pressing again when unsure the first press landed — while
   * making "fire it repeatedly" impossible. Second lock on a door that
   * already has its own key.
   */
  const limited = await rateLimited("bridge/reveal");
  if (limited) return limited;

  const startedAt = Date.now();
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  // One scoping helper, applied identically to the read, the count and the
  // clock update. Three places that must agree: if the update were wider
  // than the read, a rehearsal would move 74 people's start dates while
  // activating one — silently shortening everyone's free month.
  // T is deliberately unconstrained and `eq` reached through a cast: a
  // `T extends { eq… }` bound makes tsc walk the whole PostgREST builder
  // type and give up (TS2589, "excessively deep"). The cast costs nothing
  // real — every caller below passes a query builder.
  const scoped = <T>(q: T): T =>
    onlyEmail
      ? (q as { eq: (column: string, value: unknown) => T }).eq("email", onlyEmail)
      : q;

  const { data: pending, error } = await scoped(
    admin
      .from("scheduled_gifts")
      .select("id, profile_id, email, name, tier, months, starts_at, source")
      .is("applied_at", null),
  )
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
  const { count: totalPending } = await scoped(
    admin
      .from("scheduled_gifts")
      .select("id", { count: "exact", head: true })
      .is("applied_at", null),
  );

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      // Named when scoped, so a dry run reading "1" is obviously a rehearsal
      // and not a terrifying result on event morning.
      ...(onlyEmail ? { onlyEmail: redactEmail(onlyEmail) } : {}),
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
  await scoped(
    admin.from("scheduled_gifts").update({ starts_at: nowIso }).is("applied_at", null),
  );

  let activated = 0;
  let emailed = 0;
  let remaining = 0;
  const failures: string[] = [];

  for (const row of rows) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      remaining++;
      continue;
    }

    const res = await revealOneGuest(
      { ...(row as unknown as ScheduledGiftRow), starts_at: nowIso },
      nowIso,
    );
    if (res.activated) activated++;
    if (res.emailed) emailed++;
    if (!res.ok || !res.emailed) failures.push(res.detail);
  }

  const stillPending = Math.max(0, (totalPending ?? 0) - activated);

  return NextResponse.json({
    ok: true,
    /*
     * Echoed on the real path too, not just the dry run. `remaining` is
     * scoped like everything else, so a rehearsal reports 0 — true for that
     * one person and dangerously misleading without this field, because
     * TSLS reads `remaining` to decide whether to press again. Seeing
     * onlyEmail beside it is what stops "remaining: 0" being read as
     * "everyone is done".
     */
    ...(onlyEmail ? { onlyEmail: redactEmail(onlyEmail), rehearsal: true } : {}),
    activated,
    emailed,
    // Named separately from `activated`: a guest whose grant landed but whose
    // email didn't has access and doesn't know it, which is the one outcome
    // that looks fine from the database and isn't.
    remaining: stillPending + remaining,
    failures,
  });
}

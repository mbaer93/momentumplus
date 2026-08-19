# Momentum+ Launch Checklist

**Go-live: October 14, 2026.**

**Code** = built and tested in this repo. **Ops** = accounts, credentials,
content, or a decision only Matt (or SLC) can supply.

Rewritten 2026-08-19 against the built app. The previous version had drifted
far enough to be dangerous — it told you to run migrations `0001–0003` when
the repo was at `0094`, and listed five crons when there are twelve. A stale
checklist is worse than none: it is followed.

---

## How launch day actually works

Nothing here is a deploy. Everything ships behind two switches in
**Admin → Control Center**, so October 14 is a button, not a release.

1. **Per-feature launch gate** (`app_features.is_launched`). A feature that
   is not launched is reachable by admins only. `setFeatureLaunched` flips
   it. Admins always bypass, which is how you preview before pressing it.
2. **The access grid** (tier × feature). Launched is necessary, not
   sufficient — the grid still decides which tiers reach what.
3. **Go Live for Testers** — a rehearsal switch that lifts the launch gate
   *for test accounts only*, bounded by each tester's own tier. Real members
   see no change whether it is on or off.

**Rehearse before you launch:** mark a few accounts as testers
(Admin → Members), press *Go Live for Testers*, and walk the app as each
tier. That is the dress rehearsal for the 14th.

---

## Infrastructure

- [ ] **Ops** — Domain + SSL on `momentumplus.co`; Vercel production env vars set from `.env.example` (41 variables)
- [ ] **Ops** — `CRON_SECRET` set, or every scheduled job 401s silently
- [x] **Code** — 12 crons registered in `vercel.json`: attendance, TSLS import, reconcile, dunning, reminders, summaries, scheduled-posts, monthly-report, gift-activate, health, podcast, badges
- [x] **Code** — Cron heartbeats + a test pinning `CRON_EXPECTATIONS` to `vercel.json`, so a new job cannot ship unwatched
- [ ] **Ops** — Supabase project with **all 94 migrations** applied (`supabase/migrations/`), verified by Admin → Connections → *Page data queries*

## Verify the database, don't assume it

- [x] **Code** — *Page data queries* probes all 317 embedded selects against the live database
- [ ] **Ops** — Run **Admin → Connections → Run checks now** after every migration batch. This is the check that catches a migration breaking a query it never mentions (CLAUDE.md rule 6; migration 0087 took every session page offline for a day)
- [ ] **Ops** — Confirm all 14 health checks pass: Database, Stripe, Zoom, Anthropic, Go High Level, Stream Chat, Mux, Registration sheet, TSLS app, TSLS bridge key, Page data queries, Public pages, Scheduled jobs, Member error reports

## Billing and access

GHL is the source of truth for payment status (CLAUDE.md rule 2); Stripe
handles on-site checkout.

- [ ] **Ops** — GHL products for Monthly $198 / 3-Month $534 / 6-Month $948 / 12-Month $1,668, with `GHL_PRODUCT_TIER_MAP` set to their ids
- [ ] **Ops** — GHL workflow posts to `/api/webhooks/ghl` with the shared secret
- [ ] **Ops** — Stripe live keys in Admin → Connections; a real card charged once and refunded
- [x] **Code** — Webhook signature verification (HMAC + shared-secret fallback, timing-safe)
- [x] **Code** — Payment success / failure (7-day grace) / cancel → membership lifecycle, unit-tested
- [x] **Code** — Stripe checkout, missed-checkout heal path, and dunning
- [x] **Code** — Nightly reconciliation: expiry sweep + GHL contact drift
- [ ] **Ops** — Walk a full purchase → access flow end to end **before** the real products go live

## TSLS crossover

- [ ] **Ops** — Google service account created and the registration sheet shared with it
- [ ] **Ops** — `TSLS_TYPE_MAP` set (registration type → tier + months; VIP is spec-fixed at 3 months)
- [ ] **Ops** — `MOMENTUM_BRIDGE_KEY` and `TSLS_SSO_KEY` matched on both sides
- [x] **Code** — Sheet import (idempotent by email + year), bridge provisioning, SSO handoff
- [ ] **Ops** — Dry-run the import against the real sheet with invites **off**, and check the counts

## Sessions, video, community

- [ ] **Ops** — Zoom: Server-to-Server OAuth app *and* Meeting SDK app (both on Sierra's account)
- [ ] **Ops** — Stream app key + secret; Mux tokens + signing key; Anthropic key
- [x] **Code** — Publish creates the Zoom meeting; embedded live room; attendance sync; "Open in Zoom" fallback
- [x] **Code** — Tier-gated channels with server-issued Stream tokens; signed Mux playback; AI summaries
- [ ] **Ops** — First month of sessions scheduled and published

## Auth and email

- [ ] **Ops** — SPF/DKIM on the sending domain; Resend SMTP configured in Supabase
- [ ] **Ops** — `RESEND_WEBHOOK_SECRET` set, and a test bounce confirmed to appear in Admin → Email Delivery
- [x] **Code** — Email/password, magic link, reset, and invite flows
- [x] **Code** — Recovery failures land on `/reset` with the reason, not a dead login page
- [x] **Code** — Every forced-setup page carries "Signed in as … Not you? Log out"

## Content

- [ ] **Ops** — Speakers, sessions, resources, sponsors (with real logo files), courses
- [x] **Ops** — Badge and guide copy reviewed by Matt (2026-08-19). Thresholds and level names confirmed as-is
- [ ] **Ops** — Privacy policy, Terms, cookie notice (needs approved copy)

## Engagement (badges, tags, offers)

- [x] **Code** — Badge ledger (append-only), nightly sync, GHL contact tags, badge-targeted announcements, in-app offers
- [x] **Ops** — Founding Member closes at 100 members or October 1, 2027, whichever comes first (Matt, 2026-08-19)
- [ ] **Ops** — Build the first GHL segment on a `momentum-*` tag and confirm it populates

## QA

- [x] **Code** — 423 unit tests; 31 Playwright specs
- [x] **Code** — Every mutating API route has at least one test (all 18 audited)
- [x] **Code** — Contrast (WCAG AA) and Playwright gates on every PR
- [ ] **Ops** — Re-test the webhook flows against live Supabase + GHL; the e2e suite runs in preview mode and cannot exercise real auth or real writes
- [ ] **Ops** — Mobile pass on real devices
- [ ] **Ops** — Member beta with 5–10 friendly accounts, using the tester rehearsal
- [ ] **Ops** — Admin walkthrough with staff

## Launch day

- [ ] **Ops** — Rehearse with *Go Live for Testers* on, as each tier
- [ ] **Ops** — End the rehearsal
- [ ] **Ops** — Launch each feature in Control Center, and confirm the access grid per tier
- [ ] **Ops** — Watch Admin → Connections and Admin → Platform Errors through the first day

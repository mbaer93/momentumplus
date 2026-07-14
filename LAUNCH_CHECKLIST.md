# Momentum+ Launch Checklist

Tracks SPEC.md §7 against the built app. **Code** = built & tested in this repo.
**Ops** = needs accounts/credentials/content only Matt (or SLC) can provide.

## Infrastructure
- [ ] **Ops** — Domain + SSL, Vercel production env (connect repo, set env vars from `.env.example`)
- [x] **Code** — Vercel config: crons for attendance, TSLS import, reconcile, reminders, summaries (`vercel.json`)
- [ ] **Ops** — Supabase project: run `supabase/migrations/0001–0003`, set the three Supabase env vars

## Billing / access (GHL is the source of truth)
- [ ] **Ops** — GHL products created for Monthly $198 / 3-Mo $534 / 6-Mo $948 / 12-Mo $1,668
- [ ] **Ops** — `GHL_PRODUCT_TIER_MAP` env set with those product ids
- [ ] **Ops** — GHL workflow posts webhooks to `/api/webhooks/ghl` with the shared secret header
- [x] **Code** — Webhook signature verification (HMAC + shared-secret fallback, timing-safe)
- [x] **Code** — payment success / failed (7-day grace) / cancel → membership lifecycle (unit-tested)
- [ ] **Ops** — Test full purchase → access flow with GHL test events **before** wiring real products
- [x] **Code** — Nightly reconciliation (expiry sweep + GHL contact drift check)
- [x] **Code** — /expired renewal page with confirmed pricing; `NEXT_PUBLIC_GHL_RENEW_URL` link

## TSLS import
- [ ] **Ops** — Google service account created; registration sheet shared with it
- [ ] **Ops** — `TSLS_TYPE_MAP` set (non-VIP registration types → tier + months; VIP is spec-fixed 3 mo)
- [x] **Code** — Sheet import: magic-link invite, membership insert, idempotent by email+year, marks rows processed
- [ ] **Ops** — Dry-run against the real sheet

## Zoom (two apps on Sierra's account)
- [ ] **Ops** — Server-to-Server OAuth app → ZOOM_ACCOUNT_ID / CLIENT_ID / CLIENT_SECRET
- [ ] **Ops** — Meeting SDK app → ZOOM_SDK_CLIENT_ID / CLIENT_SECRET
- [x] **Code** — Publish creates meeting; embedded live room (component view) with signature endpoint; attendance sync cron; "Open in Zoom app" fallback

## Community / video / AI
- [ ] **Ops** — Stream app (key + secret); Mux (tokens + signing key); Anthropic API key
- [x] **Code** — Tier-gated channels + server-issued Stream tokens; signed Mux playback; Claude summaries pipeline (cron + admin regenerate)

## Auth & email
- [ ] **Ops** — Password reset + email deliverability (SPF/DKIM on the sending domain; Supabase SMTP or GHL)
- [x] **Code** — Email/password + magic link + reset + invite flows

## Content seeding (admin portal is live for all of these)
- [ ] **Ops** — Speakers, first month of sessions, resources, sponsors (incl. real logo files)

## QA
- [x] **Code** — Playwright suite green: login render, portal shell, sessions/enroll UI, tier gating, notes persistence, .ics, admin (20 tests)
- [x] **Code** — 43 unit tests: GHL lifecycle, grace windows, .ics, Zoom + Stream + Mux tokens, TSLS mapping, summary parsing
- [ ] **Ops** — Webhook flow re-test against live Supabase + GHL (the e2e suite runs in preview mode)
- [ ] **Ops** — Mobile pass on real devices (grids are responsive; the mockup is desktop-first — collapsing sidebar is a post-launch enhancement)
- [ ] **Ops** — Privacy policy + ToS pages, cookie notice (need approved copy)
- [ ] **Ops** — Admin walkthrough with staff; member beta with 5–10 friendly users

# Momentum+

The subscription members-only community and learning platform for the
**Tri-State Leadership Summit (TSLS)**, built by Sierra Learnership
Collaborative, LLC.

This repo follows the phased build in [`CLAUDE.md`](./CLAUDE.md) and the
technical spec in [`SPEC.md`](./SPEC.md). The approved visual prototype lives at
[`mockup/momentum-plus-v5.html`](./mockup/momentum-plus-v5.html) — it **is** the
design system; UI should match it.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** — tokens mirror the mockup palette (SPEC.md §6)
- **Supabase** — Postgres, Auth, Row Level Security
- Later phases: Stream Chat, Mux, Anthropic API, Go High Level, Zoom, Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase values (see below)
npm run dev                  # http://localhost:3000
```

> **Preview without Supabase.** Phase 1 runs without credentials: when the
> Supabase env vars are absent, auth is bypassed so you can view the portal
> shell and dashboard (populated with placeholder data). Set the Supabase
> variables in `.env.local` to enable real email/password + magic-link auth and
> route protection.

### Environment

Every variable is documented in [`.env.example`](./.env.example). Phase 1 needs
only the Supabase block:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; never exposed to the client)

### Database

The full schema and RLS policies (SPEC.md §3) are a single migration:
[`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql).

Apply it with the Supabase CLI (`supabase db push`) or by pasting it into the
Supabase SQL editor. It creates every table, the `is_admin()` / `can_view()`
access helpers, RLS policies on all tables, and a trigger that provisions a
`profiles` row on sign-up.

## What's built (Phases 1–8: feature-complete, credential-gated)

Every integration is env-gated: the app runs fully in **preview mode** with
placeholder data, and each service switches on when its credentials land in
`.env.local` — no code changes. See [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md)
for exactly what remains (accounts, credentials, content, live-data QA).

- **Phase 1** — scaffold, Supabase auth (password + magic link + reset),
  full schema + RLS (migrations 0001–0003), portal shell + dashboard
- **Phase 2** — sessions: filters/cards/detail tabs, enroll, autosaving
  private notes, .ics calendar, Zoom meeting creation on publish, embedded
  live room (Meeting SDK, 30-min join window), attendance sync cron
- **Phase 3** — membership tiers with 7-day grace semantics, GHL webhook
  sync (signature-verified), TSLS Sheets import (idempotent, magic-link
  invites), nightly reconciliation, /expired renewal page with confirmed
  pricing
- **Phase 4** — community chat (tier-gated channels, server-issued Stream
  tokens), notification prefs (email/SMS opt-in/in-app), session-reminder
  cron, profile with the learning record
- **Phase 5** — video library with signed Mux playback + view tracking, and
  Claude-generated AI session summaries (cron + admin regenerate)
- **Phase 6** — speakers directory + profiles, resources with usage
  tracking, sponsors page + right-rail ads with batched impression/click
  tracking
- **Phase 7** — admin portal: dashboard stats, session CRUD + publish,
  member management (grants/extend/expire), announcement composer
  (tier + channel targeting), sponsor management with performance counts
- **Phase 8** — Playwright critical-flow suite (20 tests) + 43 unit tests

### Tests

| Command | What it covers |
| --- | --- |
| `npm test` | 43 unit tests: GHL membership lifecycle, grace windows, .ics, Zoom/Stream/Mux token signing, TSLS row mapping, AI summary parsing, access gating |
| `npm run test:e2e` | 20 Playwright tests against the built app: login render, portal shell, sessions + enroll UI, tier gating, notes autosave, .ics endpoint, admin portal |

In constrained environments point Playwright at a preinstalled browser:
`PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Project layout

```
app/
  (auth)/login, (auth)/reset      # full-screen auth pages
  (portal)/dashboard, /community, /sessions[/id], /library[/id],
           /education, /speakers[/id], /resources, /sponsors,
           /calendar, /profile, /admin
  auth/callback                   # code → session exchange
components/
  icons.tsx                       # stroke-only SVG icons from the mockup
  portal/                         # Sidebar, Topbar, nav config, PlaceholderPage
lib/
  supabase/                       # browser/server/middleware clients
  access.ts, types.ts             # tier gating + domain types
  current-member.ts, placeholder-data.ts
supabase/migrations/              # schema + RLS
mockup/momentum-plus-v5.html      # approved design reference
```

## Scripts

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Start the dev server               |
| `npm run build`     | Production build                   |
| `npm run start`     | Serve the production build         |
| `npm run lint`      | ESLint (next/core-web-vitals)      |
| `npm run typecheck` | `tsc --noEmit`                     |

Run `npm run lint && npm run typecheck` before declaring any task complete.

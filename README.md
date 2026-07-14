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

## What's built (Phase 1)

- Next.js + TypeScript + Tailwind scaffold with the mockup design tokens
- Supabase auth: email/password + magic link, password reset, auth callback
- Route-protection middleware (session refresh + tier/route gating hooks)
- Full database schema with RLS policies as a migration
- Portal shell (sidebar + topbar) and the member **dashboard**, matching the
  mockup; other portal destinations are navigable placeholders scoped to their
  upcoming phase

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

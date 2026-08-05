# Momentum+ — Project Instructions for Claude Code

## What this project is
Momentum+ is a subscription-based members-only community and learning platform for the
Tri-State Leadership Summit (TSLS), built by Sierra Learnership Collaborative, LLC.
Members get live sessions, a recorded video library with AI summaries, community chat,
speaker profiles, partner resources, sponsor content, and a personal learning record.

## Source of truth
- `SPEC.md` — full technical specification. Read it before starting any phase.
- `mockup/momentum-plus-v5.html` — the approved visual prototype. This IS the design
  system: colors, typography, spacing, components, and every screen. When building UI,
  open this file and match it. Do not invent new visual styles.

## Stack (do not substitute without asking)
- Next.js 14+ (App Router) + TypeScript
- Tailwind CSS — tokens must mirror the mockup palette (see SPEC.md §Design System)
- Supabase — Postgres, Auth, Row Level Security, Storage
- Stream Chat (React SDK) for community
- Mux for video hosting/playback
- Anthropic API for AI session summaries
- Go High Level API + webhooks for subscription/payment sync
- Zoom API (Server-to-Server OAuth) for meeting creation + attendance reports
- Vercel for hosting

## Non-negotiable rules
1. **Access control lives in the database.** Every table has RLS policies. Tier gating
   (VIP channels, exclusive sessions, bonus content) is enforced server-side, never
   only in the UI.
2. **GHL is the source of truth for payment status.** Webhooks update `memberships`;
   the app never assumes access without checking `access_expires_at` and status.
3. **Design fidelity.** Navy #0B1622, gold #B8965A, cream #F8F6F1, Playfair Display
   headings, Inter body, radii from the mockup scale (2/4/8/10/12/14/16/20px — 4px
   is the default for inputs, buttons, and cards), stroke-only SVG icons, NO emoji
   in UI.
4. **Every session tracks three things:** enrollments (signup), attendance (from Zoom
   join data), and notes (private per member). These feed the member profile stats.
5. Secrets go in `.env.local` (gitignored). Never hardcode keys. `.env.example` lists
   every required variable with a comment.

## Build phases (work in order, one phase per session/PR)
- Phase 1: Scaffold + auth + database schema + member dashboard shell
- Phase 2: Sessions (CRUD, enroll, calendar .ics, Zoom integration)
- Phase 3: Membership tiers + GHL webhook sync + TSLS Sheets import
- Phase 4: Community chat (Stream) + notifications (email via GHL, SMS opt-in)
- Phase 5: Video library (Mux) + AI summaries (Anthropic API)
- Phase 6: Speakers, resources, sponsors (incl. ad rail + impression tracking)
- Phase 7: Admin portal
- Phase 8: Polish, tests, launch checklist

## Testing expectations
- Playwright for critical flows: login, enroll, tier gating, GHL webhook handling
- Every API route that mutates data gets at least one test
- Run `npm run lint && npm run typecheck` before declaring any task complete

## When unsure
Ask Matt rather than guessing on: pricing/tier rules, copy/wording, anything
sponsor-facing, and anything that emails or texts real members.

## Claude autonomy (Matt, 2026-08-05)
Claude has standing authority, without asking first, to:
- Push its work (including deploy-triggering pushes).
- Merge its own PRs once lint, typecheck, and tests all pass and there are
  no unresolved review comments.

The "When unsure" list above still requires asking first — autonomy covers
process (push/merge), not those judgment calls. Never merge a PR Claude
didn't author unless Matt asks.

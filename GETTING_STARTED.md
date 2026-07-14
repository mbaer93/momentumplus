# Building Momentum+ with Claude Code — Getting Started

## Before you open Claude Code (one-time setup, ~1 hour)
Create accounts and collect keys. You'll paste these into `.env.local` when Claude
Code asks for them:

1. **Supabase** (supabase.com) — free tier fine to start. New project → copy the
   Project URL, anon key, and service-role key.
2. **Vercel** (vercel.com) — connect your GitHub account. Free to start.
3. **GitHub** — create an empty repo `momentum-plus`.
4. **Go High Level** — you have this. Create an API key + note your Location ID.
   (Webhooks get configured in Phase 3.)
5. **Zoom** — marketplace.zoom.us → Build App → Server-to-Server OAuth →
   account ID, client ID, client secret. Needs a paid Zoom plan for cloud recording.
6. **Stream** (getstream.io) — free tier → app → API key + secret. (Phase 4)
7. **Mux** (mux.com) — access token + secret. (Phase 5)
8. **Anthropic** (console.anthropic.com) — API key. (Phase 5)
9. **Google Cloud** — service account with Sheets read access; share your TSLS
   registration sheet with the service account email. (Phase 3)

## Set up the repo
```bash
git clone <your-empty-repo>
cd momentum-plus
# copy in this starter kit:
#   CLAUDE.md, SPEC.md, and mockup/momentum-plus-v5.html
git add . && git commit -m "Project spec + approved mockup"
claude   # start Claude Code in the repo
```

## How to run the build
Work one phase at a time. Start each phase in a fresh Claude Code session so context
stays sharp. Suggested kickoff prompts:

**Phase 1**
> Read CLAUDE.md and SPEC.md. Scaffold the Next.js app per the spec: TypeScript,
> Tailwind with the design tokens from SPEC.md §6, Supabase auth (email/password +
> magic link), the full database schema with RLS policies as a migration, and the
> portal shell (sidebar, topbar, dashboard page) matching mockup/momentum-plus-v5.html.
> Use placeholder data where the backend isn't built yet. Set up .env.example.

**Phase 2**
> Read CLAUDE.md and SPEC.md §3–4. Build the sessions feature: admin CRUD, member
> enrollment, .ics calendar downloads, Zoom meeting creation on publish, join-URL
> reveal 30 minutes before start, and the attendance sync from Zoom participant
> reports. Match the session cards and session detail modal in the mockup.

**Phases 3–8**: same pattern — point it at the relevant SPEC.md sections and the
mockup, one phase per session. After each phase: review the diff, run the app locally
(`npm run dev`), test the flows yourself, commit, deploy to Vercel preview.

## Tips that will save you pain
- Deploy to Vercel from Phase 1 so deployment problems surface early, not at launch.
- Test the GHL webhook flow with GHL's test events BEFORE wiring real products.
- Keep the mockup file in the repo forever — it's the design reference Claude Code
  will keep returning to.
- When something looks wrong, say "compare this against mockup/momentum-plus-v5.html
  and fix the differences" — pixel fidelity is a prompt away.
- Don't let any phase merge without `npm run lint && npm run typecheck` passing.

## Rough timeline (working evenings/weekends)
Phase 1: a weekend · Phases 2–3: 2–3 weeks (the integrations are the real work) ·
Phases 4–5: 2 weeks · Phases 6–7: 2 weeks · Phase 8 + beta: 1–2 weeks.
A focused developer full-time could compress this to 4–6 weeks.

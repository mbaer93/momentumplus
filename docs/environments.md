# Production vs test databases

One Supabase project used to serve everything — production traffic, Vercel
preview deploys, and local dev. That meant a bug in a preview build or a
mistyped migration touched real member data. This runbook separates them.

## The target setup

| Environment | Supabase project | Who points at it |
|---|---|---|
| **Production** | `momentumplus` (existing) | Vercel **Production** deployments only |
| **Staging / test** | `momentumplus-staging` (new) | Vercel **Preview** deployments, local dev, migration rehearsals |

Two projects, zero shared data. Losing or corrupting staging costs nothing.

## One-time setup (Supabase + Vercel dashboards)

1. **Create the staging project** — supabase.com → New project →
   `momentumplus-staging` (same region as production; the free tier is fine).
2. **Apply the schema in one paste** — open the staging project's SQL editor
   and run the whole of `supabase/baseline.sql` from this repo. That file is
   every migration in order; regenerate it any time with
   `node scripts/make-baseline.mjs`. Never run it against production.
3. **Split the Vercel env vars** — Vercel → momentumplus → Settings →
   Environment Variables. For each of:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

   change the existing value's scope from "All environments" to
   **Production only**, then add a second entry scoped to **Preview** with
   the staging project's values (staging project → Settings → API).
4. **Redeploy** any open preview so it picks up the staging values. The
   Admin → Connections page shows which database host a deployment is
   talking to — verify the preview shows the staging ref and production
   shows the original.
5. **Local dev**: put the STAGING keys in `.env.local`, never production's.
6. Optional but recommended for cost surfaces on staging: leave
   `STRIPE`-in-app config unconnected or use Stripe **test-mode** keys, and
   leave GHL/Twilio-style senders unconfigured so staging can never email
   or charge a real member.

## Migration flow from now on

1. New migration lands in a PR (as always).
2. Run it on **staging** first (SQL editor, staging project).
3. Click through the affected screens on the preview deploy.
4. Only then run it on **production**.

## Backups — the "never lose the system" half

Supabase side (Settings → Database → Backups, production project):

- **Daily backups** are included on the Pro plan (7-day retention). Confirm
  they show as running.
- **Point-in-Time Recovery (PITR)** is a paid add-on that allows restoring
  to any minute, not just last night — worth turning on for the production
  project before event season.
- Code and configuration are already safe: the schema is fully reproducible
  from this repo (that's what `baseline.sql` proves), and the app itself
  redeploys from GitHub. The database is the only thing that needs backups.

## Guard rails already in the code

- Preview mode (no Supabase env at all) renders placeholder data and never
  fails open on Vercel (`lib/supabase/middleware.ts` returns 503 if env is
  missing on a deployment).
- The e2e suite pins its env to empty values, so tests can never touch any
  real database, staging included (`playwright.config.ts`).
- Admin → Connections displays the Supabase host this deployment uses, so
  "which database am I on?" is answerable at a glance.

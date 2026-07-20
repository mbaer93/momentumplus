# TSLS Summit Companion

The phone-first companion app for the in-person **Tri-State Leadership
Summit** — agenda, speakers, vendors, community, and each attendee's ticket.
It is a **separate application** from Momentum+: its own Next.js project,
its own deployment, its own domain. What it shares with Momentum+ is the
backend, on purpose:

- **Supabase** — same project: one member base, one auth system, and the
  ticket data the registration import already writes (`import_log`).
- **Stream Chat** — the same community; attendees chat with the same people
  from either app.
- **Registration** — untouched. The registration platform → live Google
  Sheet → `/api/import/tsls` cron (which runs in the Momentum+ app) keeps
  granting access exactly as it does today. This app only reads the result.

Because the two apps run on different domains, logins are separate sessions
with the **same email + password** — signing in on one does not auto-sign-in
the other. That's expected.

## Deploying (Vercel)

1. Create a **new Vercel project** from this same repository and set
   **Root Directory** to `summit-app`.
2. Add the environment variables from `.env.example` (Supabase + Stream
   values are the same ones the Momentum+ project uses; the two URL vars
   differ per app).
3. Attach the event domain (e.g. `app.thetsls.com`) to this project.
4. In **Supabase → Auth → URL Configuration**, add this domain's
   `/auth/callback` (and the domain itself) to the redirect allow-list —
   otherwise magic links can't land here.
5. Apply migration `supabase/migrations/0043_summit_companion.sql` (lives in
   the repo root with the rest of the migrations) — it adds `agenda_items`,
   `vendors`, and the attendees-can-read-their-own-ticket policy.

## Admin

`/admin` (admin-tier members only): event settings (name, dates, venue,
registration/upgrade URLs), agenda CRUD, and vendor CRUD. Content edited
here is stored in the shared database.

## Development

```
npm install
npm run dev        # http://localhost:3001
npm run typecheck && npm run lint && npm test
```

With no Supabase env configured the app runs in preview mode with sample
data (local dev only; deployed environments hard-fail instead).

## TODO before launch

- [ ] Add app icons under `public/icons/` (192/512 + maskable) and wire
      them into `app/manifest.ts` so Add-to-Home-Screen gets a real icon.
- [ ] Confirm event details in `/admin` (defaults were pulled from public
      listings for thetsls.com).
- [ ] Set the ticket-upgrade URL in `/admin` once the upgrade product page
      exists.

# TSLS Summit Companion

The phone-first companion app for the in-person **Tri-State Leadership
Summit** — agenda, speakers, vendors, community, and each attendee's ticket.

It is **completely separate from Momentum+**: its own Next.js app, its own
Vercel project, its own Supabase project, and its own Stream Chat app.
Nothing in this app holds a Momentum+ credential, so nothing here can touch
or break Momentum+.

## How it relates to the existing systems

- **Registration (untouched):** attendees keep registering exactly as
  today, landing in the live Google Sheet. This app's importer
  (`/api/import/tsls`, cron every 30 min) reads that sheet with a
  **read-only** Google scope, invites each attendee by email into this
  app's own Supabase, and records their ticket. It never writes to the
  sheet; Momentum+'s importer and its "processed" markers are unaffected.
- **TSLS feeds Momentum+ — one-way:** every ticket includes a Momentum+
  gift (general = 1 month, VIP = 3 months, member level), granted by
  Momentum+'s own existing import from the same sheet. This app doesn't
  grant it — it only *reveals* it (see below).
- **The announcement toggle:** the app shows **nothing about Momentum+**
  until an admin checks "The Momentum+ gift has been announced on stage"
  in `/admin`. At that moment the Momentum+ header button and the
  "your ticket includes N months" cards appear for everyone.
  ⚠️ Operational note: Momentum+'s importer emails attendees Momentum+
  invites as soon as its `TSLS_TYPE_MAP` maps their registration type —
  to keep the surprise, leave general admission unmapped there until
  announcement day (unmapped rows are skipped and import later).
- **Community:** the event has its own Stream app with event channels
  (#general, #announcements, #ask-a-speaker, #networking, #vip-lounge for
  VIP tickets). It is not connected to the Momentum+ community.
- **Speakers:** the event lineup is managed in `/admin` here — not synced
  from Momentum+.

## Setting it up

1. **Supabase**: create a new project, run
   `supabase/migrations/0001_init.sql` (SQL editor or CLI). In Auth →
   URL Configuration set the site URL to this app's domain and add
   `/auth/callback` to the redirect allow-list. Point the invite/magic-link
   email templates at `/auth/confirm` (Supabase SSR pattern).
2. **Vercel**: new project from this repo, **Root Directory `summit-app`**;
   add the env vars from `.env.example`; attach the event domain
   (e.g. `app.thetsls.com`). The cron in `vercel.json` runs the importer
   every 30 minutes using `CRON_SECRET`.
3. **Google Sheet**: share the live registration sheet with the service
   account email as a **Viewer** (read-only is enough — and all this app
   can do).
4. **Stream**: create a new (free-tier is fine) Stream Chat app and set its
   key/secret. Channels are provisioned automatically on first sign-in.
5. **Admins**: put your email(s) in `SUMMIT_ADMIN_EMAILS`, sign in, and
   open `/admin` to confirm event settings, build the agenda, add speakers
   and vendors.

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
- [ ] Day-of: flip the "announced on stage" toggle in `/admin` during the
      Momentum+ gift reveal.

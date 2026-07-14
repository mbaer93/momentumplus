# Momentum+ Technical Specification
v1.0 — July 2026. Companion to `mockup/momentum-plus-v5.html` (approved prototype).

## 1. Product summary
Password-protected member portal. Eight access tiers. Subscriptions billed/managed in
Go High Level; TSLS event registrations auto-provision time-limited access via a
Google Sheets/registration pipeline. Features: dashboard with next-up banner, live +
scheduled sessions with enrollment/attendance/calendar sync, recorded video library
with AI summaries, per-session private member notes, community chat, speaker profiles
(sortable by industry, full-page profiles), partner resources with usage tracking,
sponsors (dedicated page + right-rail ads with impression/click tracking), calendar,
member profile with learning history and notification preferences, full admin portal.
External links: TSLS Summit site, Sierra Learnership Collaborative site.

## 2. Access tiers
| Tier | Source | Duration |
|---|---|---|
| tsls_attendee | Summit registration import | N months (per registration type) |
| tsls_vip | VIP Summit registration | 3 months |
| sub_3mo / sub_6mo | GHL one-time purchase | 3 / 6 months |
| sub_monthly / sub_annual | GHL recurring | rolling / 12 months |
| speaker | granted by admin | ongoing |
| admin | internal | ongoing |

Gating levels used by content: `all_members`, `vip_plus` (vip, annual, speaker, admin),
`admin_only`. Sessions/resources/videos each carry a `min_access` field.

## 3. Data model (Supabase / Postgres)
```
profiles          id (auth.uid), full_name, email, phone, avatar_url, bio,
                  industry, company, title, links jsonb, created_at
memberships       id, profile_id, tier, status (active|past_due|canceled|expired),
                  access_starts_at, access_expires_at, ghl_contact_id,
                  source (ghl|tsls_import|admin), created_at
speakers          id, profile_id nullable, name, title, bio, headshot_url,
                  industries text[], links jsonb, featured bool
sessions          id, title, description, speaker_id, category, starts_at,
                  duration_min, zoom_meeting_id, zoom_join_url, capacity,
                  min_access, status (draft|scheduled|live|completed|archived)
enrollments       id, session_id, profile_id, enrolled_at, attended bool,
                  attended_source (zoom|manual), unique(session_id, profile_id)
session_notes     id, session_id, profile_id, body text, updated_at,
                  unique(session_id, profile_id)   -- RLS: owner only
ai_summaries      id, session_id unique, takeaways jsonb, quotes jsonb,
                  action_items jsonb, highlights text, model, generated_at
videos            id, session_id nullable, title, category, mux_asset_id,
                  mux_playback_id, duration_sec, min_access, published_at
video_views       id, video_id, profile_id, watched_at, seconds_watched
resources         id, title, category, description, url/file, partner_name,
                  min_access, active bool
resource_uses     id, resource_id, profile_id, used_at
sponsors          id, name, tier (title|partner|community), tagline, offer,
                  website, logo_url, rail_active bool, starts_at, ends_at
sponsor_events    id, sponsor_id, profile_id nullable, kind (impression|click), at
announcements     id, title, body, audience_tiers text[], channels text[],
                  sent_at, sent_by
notification_prefs profile_id, key, email bool, sms bool, in_app bool
                  -- keys: session_new, session_reminder, recording_ready,
                  -- chat_reply, chat_channel, chat_dm, platform (email locked on),
                  -- resource_new, event_reminder
```
RLS: members read published content at/below their access level; write own notes,
enrollments, prefs, profile. Admin role bypass via `is_admin()` helper. Service-role
key used only in server routes (webhooks, imports, admin actions).

## 4. Integrations
### Go High Level (billing source of truth)
- Products/subscriptions configured in GHL; portal never takes payment directly.
- Webhooks → `/api/webhooks/ghl`: payment success (create/extend membership),
  payment failed (→ past_due, grace period 7 days), cancel (→ canceled, access until
  period end). Verify webhook signature. Store `ghl_contact_id` on membership.
- Nightly reconciliation job (Vercel cron) pulls GHL contacts and repairs drift.

### TSLS registration import (Google Sheets)
- Registration platform writes rows to a Sheet: name, email, registration type.
- `/api/import/tsls` (cron, every 30 min): read Sheet via service account, map
  registration type → tier + months, upsert profile + membership, send invite email
  (Supabase magic-link invite). Mark row processed. Idempotent by email + event year.

### Zoom (Server-to-Server OAuth)
- Admin creates session → API creates Zoom meeting, stores join URL.
- Join URL revealed to enrolled members from 30 min before start.
- After meeting ends: webhook/poll pulls participant report → set `attended=true`
  by matching registrant email. Store recording reference for Mux ingest.

### Mux (video)
- Zoom cloud recording (or manual upload in admin) → Mux asset → playback ID.
- Signed playback tokens so URLs can't be shared outside the portal.

### Anthropic API (AI summaries)
- After recording is processed: transcript (Zoom transcript or Whisper) → Claude
  prompt → structured JSON {takeaways[], quotes[], action_items[], highlights}
  → `ai_summaries`. Admin can regenerate/edit before publishing. Show
  "Generated by Momentum+ AI" attribution as in mockup.

### Stream Chat (community)
- Channels: general, announcements (admin-post-only), networking, speaker-qa,
  resources, vip-only (vip_plus gate), annual-members. DMs enabled.
- Server issues Stream user tokens with tier-based channel grants at login.
- Speaker/tier badges mapped from membership tier to Stream user role metadata.

### Notifications
- Email: send via GHL (keeps all email in one place) or Resend. Announcement
  composer in admin selects audience tiers + channels; respects per-user prefs.
- SMS: GHL SMS (or Twilio) — strictly opt-in, phone captured in prefs UI.
- In-app: `notifications` bell fed by Supabase realtime.
- Session reminders: cron 30 min before start → enrolled members per prefs.

## 5. App structure (Next.js App Router)
```
/(auth)/login, /reset
/(portal)/dashboard, /community, /sessions, /sessions/[id],
          /library, /library/[id], /speakers, /speakers/[id],
          /resources, /sponsors, /calendar, /profile
/(admin)/admin/{dashboard,content,announcements,users,sponsors}
/api/webhooks/ghl, /api/webhooks/zoom, /api/import/tsls,
/api/cron/{reminders,reconcile,summaries}
```
Middleware: require session; check membership active + not expired; admin routes
require admin tier. Sponsor rail component renders on portal pages except community
and profile (per mockup), logging impressions (batched) and clicks.

## 6. Design system (from mockup — copy exactly)
Tokens: navy #0B1622, navy-2 #14243A, navy-3 #1C3050, cream #F8F6F1, warm-gray
#EDE9E3, mid-gray #B0A99E, text #1A2332, gold #B8965A, gold-light #D4AE75,
gold-pale #F4EDE0, accent-red #A04040, accent-blue #3A6B96, accent-green #3A7055,
purple #5C3D7A (admin/VIP). Playfair Display headings, Inter body. 4px radii,
1px warm-gray borders, gold rules under section headings, square status indicators,
stroke-only SVG icons (extract from mockup), uppercase letterspaced buttons.
NO emoji. Admin chrome uses purple accent.

## 7. Launch checklist
- [ ] Domain + SSL, Vercel production env
- [ ] Privacy policy + ToS pages, cookie notice
- [ ] GHL products live, webhook signature verified, test full purchase → access flow
- [ ] TSLS import dry-run against real sheet
- [ ] Password reset, email deliverability (SPF/DKIM)
- [ ] Mobile pass on all portal pages
- [ ] Playwright suite green: login, tier gating, enroll, webhook, notes persistence
- [ ] Seed: speakers, first month of sessions, resources, sponsors
- [ ] Admin walkthrough with staff; member beta with 5–10 friendly users
```

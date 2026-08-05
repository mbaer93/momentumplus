# TSLS handoff — mirror the Momentum+ admin panel

**Why:** Matt (2026-08-05): "TSLS Admin Center is a mess … I want both admin
panels to be similar in their naming convention, layout and ability, with the
only differences being the admin settings that are specific to the system.
**Momentum+ should be the main source to mirror.**"

Three work items, in priority order. The Momentum+ side of all three is
already built (this repo) — quote it as the reference implementation.

---

## 1. View As for regular admins (small)

Momentum+ reference: `app/(portal)/admin/control-center/view-as-actions.ts`,
`lib/current-member.ts`, `components/admin/ViewAsPicker.tsx`.

- Any admin (not just Super) may start a View-As preview. It's safe because
  the preview only ever NARROWS what the signer already sees — the cookie is
  re-checked against their real admin role on every request and does nothing
  in anyone else's browser.
- The Control Center / Super-only settings pages stay Super Admin only.
- Put the picker on the admin home page so regular admins can reach it
  (Momentum+ renders `ViewAsPicker` above the card groups).

## 2. Admin panel restructure — mirror Momentum+ naming & layout (the big one)

Momentum+ reference: `app/(portal)/admin/page.tsx`. Its structure:

- **Header**: "Admin Panel" + stats row (4 stat cards).
- **View as a member** picker.
- **Card groups**, each with an uppercase gold group heading + one-line sub,
  cards filtered by per-admin area permissions and `superOnly`:

| Group | Sub-line | Cards (Momentum+) |
|---|---|---|
| People | Who's here and what access they hold | Members · Speakers · Sponsors |
| Programming & Content | Sessions, recordings, courses, and member materials | Sessions · Library Categories · Library · Grow on the Go · Branching Out · Resources · Additional Services · Testimonials |
| Communications | What members hear from you, and whether it arrived | Announcements · Email Delivery |
| Insights & History | What's working, and who did what | Analytics · Activity Log · Platform Errors (super) · Audit Log (super) |
| Money & Setup | Ads, billing, and the platform's integrations | Ad Manager · Control Center (super) · Billing — Stripe (super) · Connections (super) |

TSLS instructions:
- Reorganize the TSLS admin home into the SAME five groups with the SAME
  group names and sub-line style. Slot every existing TSLS card into the
  group where its Momentum+ counterpart lives; event-specific cards
  (Run Book, Check-in, Staff, Planning Board, Print Center, Tickets…) get a
  sixth group — suggested: **"Event Operations" / "Running the summit,
  before and on the day"** — rather than being scattered.
- **Kill near-duplicate names**: audit every card title; where two cards
  sound alike, rename to the Momentum+ vocabulary (e.g. anything like
  "Notices"/"Blasts"/"Messages" becomes **Announcements**; delivery
  tracking becomes **Email Delivery**; error monitors become
  **Platform Errors**). One name per concept, identical across both apps.
- Match the visual grammar: stat cards up top, group heading style, card
  tiles with icon + title + one-line description, per-admin area filtering,
  `superOnly` flags for Control Center-class cards.

## 3. Announcements: Send Now / Schedule in one composer

Momentum+ reference (all in this repo):
- `components/admin/AnnouncementComposer.tsx` — one composer with a
  **When: Send now | Schedule (+ datetime)** choice; two-step confirm
  (count audience → confirm) in both modes.
- `app/(portal)/admin/announcements/actions.ts` — `sendAnnouncement`,
  `scheduleAnnouncement`, `cancelScheduledAnnouncement`.
- `lib/announcements-delivery.ts` — the shared fan-out (idempotent per
  member via a delivery ledger) used by BOTH Send Now and the cron.
- `app/api/cron/scheduled-posts/route.ts` — every 5 min, delivers due
  scheduled announcements (row with `send_at` set, `sent_at` NULL), stamps
  `sent_at` when the run completes; budget-truncated runs resume next tick.
- Migration `0075_scheduled_announcements.sql` — `send_at` column + partial
  index on the announcements table. No separate scheduled table.

TSLS instructions:
- Rebuild the TSLS notices/announcements area to this exact shape: ONE
  composer, Send now / Schedule toggle, a "Scheduled" card with cancel, and
  a "Recently sent" card. Remove any separate "scheduled notices" section.
- Reuse TSLS's existing channel senders (it pushes email like Momentum+,
  task #100 line) inside a TSLS `lib/announcements-delivery` equivalent so
  the cron and the button share one fan-out with per-recipient journaling.
- Keep TSLS-specific audiences (GA/VIP/staff/speakers) as the audience
  chips — the STRUCTURE mirrors Momentum+, the audience list is TSLS's own.

---

## Paste-in prompt for a Claude Code session on TSLS-Companion

> Mirror the Momentum+ admin panel in three steps, using
> mbaer93/momentumplus as the reference implementation (read
> `docs/tsls-admin-mirror.md` there for the full spec and file pointers).
> (1) Open "View As" to ALL admins, not just Super — mirror momentumplus
> `view-as-actions.ts` + `ViewAsPicker.tsx`: any-admin gate on the start
> action and the per-request check, picker on the admin home, Super-only
> pages still Super-only. (2) Restructure our admin home to Momentum+'s
> five card groups (People / Programming & Content / Communications /
> Insights & History / Money & Setup) plus one TSLS-specific "Event
> Operations" group; adopt Momentum+'s card names wherever both apps have
> the same concept (Announcements, Email Delivery, Analytics, Activity
> Log, Platform Errors, Audit Log, Ad Manager, Control Center,
> Connections); rename near-duplicate cards so no two sound alike; match
> the stat-cards + gold group-heading layout. (3) Rebuild notices as
> Announcements with a single composer offering Send now | Schedule
> (datetime), a Scheduled card with cancel, Recently sent history, a
> shared delivery lib with per-recipient journaling used by both the
> send action and a 5-minute cron (announcements row with send_at set,
> sent_at NULL until delivered) — mirroring momentumplus
> `AnnouncementComposer.tsx`, `announcements/actions.ts`,
> `lib/announcements-delivery.ts`, and `api/cron/scheduled-posts`.
> Keep TSLS-specific audiences and event cards; only the naming, layout,
> and mechanics mirror Momentum+. Run lint/typecheck/tests, regenerate
> any schema baseline, commit, push, and open a draft PR titled
> "Admin mirror: Momentum+ layout, View As for admins, schedulable
> announcements".

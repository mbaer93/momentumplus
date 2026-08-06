-- GHL webhook idempotency (audit 2026-08-06, P0-2): payment_success was
-- non-idempotent — every redelivery of the same event stacked another
-- tier-length extension onto the member's expiry. This ledger records each
-- processed delivery; the webhook route claims a row BEFORE applying the
-- event and skips duplicates.
--
-- Keys are either "id:<eventId>" (when the GHL workflow includes a unique
-- event/invoice/transaction id — deduped forever) or "body:<sha256>" (a
-- hash of the raw body — deduped within a retry window only, since a
-- templated GHL workflow can legitimately send an identical body for next
-- month's renewal).

create table ghl_webhook_events (
  id text primary key,
  kind text not null,
  received_at timestamptz not null default now()
);

-- Service-role only: RLS on with no policies. The webhook route writes via
-- the service client; nothing member-facing reads this table.
alter table ghl_webhook_events enable row level security;

-- Housekeeping index for pruning old body-hash rows.
create index ghl_webhook_events_received_at_idx
  on ghl_webhook_events (received_at);

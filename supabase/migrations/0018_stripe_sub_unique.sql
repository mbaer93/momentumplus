-- One membership row per Stripe subscription, enforced in the database.
-- The webhook's check-then-insert idempotency can race when Stripe delivers
-- checkout.session.completed and customer.subscription.updated concurrently
-- (or retries overlap); this index is the backstop.

-- Clean up any duplicates the race already created: keep the row with the
-- most access (latest expiry; ties broken by oldest row).
with ranked as (
  select id,
         row_number() over (
           partition by stripe_subscription_id
           order by access_expires_at desc nulls first, created_at asc
         ) as rn
  from public.memberships
  where stripe_subscription_id is not null
)
delete from public.memberships m
using ranked r
where m.id = r.id
  and r.rn > 1;

drop index if exists memberships_stripe_sub_idx;

create unique index if not exists memberships_stripe_subscription_id_key
  on public.memberships (stripe_subscription_id)
  where stripe_subscription_id is not null;

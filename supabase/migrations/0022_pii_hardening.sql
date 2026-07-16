-- PII hardening (security audit).
--
-- 1. Members could PATCH any column on their own profile row — the update
--    policy checks row ownership, not which columns change. The 0007 trigger
--    only pins admin_role/admin_perms. The sharp one: overwriting
--    stripe_customer_id then opening the billing portal reaches ANOTHER
--    member's invoices/payment method. Column-level grants restrict members
--    to the profile fields they legitimately edit; email, stripe_customer_id,
--    admin_role, admin_perms, admin_title are server/service-role only.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, phone, avatar_url, bio, industry, company, title)
  on public.profiles to authenticated;

-- 2. Members could PATCH attended/attended_source on their own enrollment
--    and fake attendance (spec: attendance comes from Zoom join data). They
--    only need insert (enroll) and delete (unenroll); revoke UPDATE.
revoke update on table public.enrollments from anon, authenticated;

-- 3. announcements SELECT had no TO clause → the anon key alone could read
--    every sent announcement. Restrict to signed-in members (admins still
--    covered by is_admin()).
drop policy if exists "announcements: read sent or admin" on public.announcements;
create policy "announcements: read sent or admin" on public.announcements
  for select to authenticated
  using (is_admin() or sent_at is not null);

-- 4. Trigger functions must not be callable as RPC endpoints (Supabase
--    advisor). They run only from their triggers; revoke public EXECUTE.
revoke execute on function public.protect_admin_columns() from anon, authenticated;
revoke execute on function public.enforce_session_capacity() from anon, authenticated;

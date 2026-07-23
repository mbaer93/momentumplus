-- ============================================================================
-- Momentum+ migration 0049: let members update their own share_contact
-- 0022 restricted profiles UPDATE to a column allowlist; 0034 then added
-- share_contact (Member Directory opt-in) without extending the allowlist,
-- so toggling it failed with "permission denied for table profiles".
-- RLS still limits updates to the member's own row; this only adds the
-- column. admin_title stays service-role-only by design — the profile
-- action now writes it server-side after an admin check.
-- ============================================================================

grant update (share_contact) on public.profiles to authenticated;

-- ============================================================================
-- Momentum+ migration 0046: remove Whitney (Matt, 2026-07-20 — feature cut).
-- Reverses 0045: drops the conversation tables (messages cascade with them)
-- and clears the stored prompt override. Destructive by design — any test
-- conversations are permanently deleted.
-- ============================================================================

drop table if exists whitney_messages;
drop table if exists whitney_conversations;

delete from app_settings where key = 'whitney';

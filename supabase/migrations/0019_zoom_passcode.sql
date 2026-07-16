-- Zoom meetings get a passcode by default on most accounts. The embedded
-- SDK join needs it explicitly (the external join URL embeds it, the SDK
-- does not), so store it at publish time. Not member-readable: column is
-- stripped from member queries; only the live-room page (server) reads it
-- for enrolled members inside the join window.
alter table public.sessions
  add column if not exists zoom_passcode text;

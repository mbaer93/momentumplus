-- ============================================================================
-- Momentum+ migration 0045: Whitney by SLC — Pro-only reflective guide.
-- Private per-member conversations with the Whitney AI guide. Members READ
-- their own conversations via RLS; all writes go through the server route
-- (service role), which enforces the Pro gate — access control lives in the
-- database per CLAUDE.md non-negotiable #1.
-- ============================================================================

create table whitney_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index whitney_conversations_profile_idx
  on whitney_conversations (profile_id, updated_at desc);

create table whitney_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references whitney_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index whitney_messages_conversation_idx
  on whitney_messages (conversation_id, created_at);

alter table whitney_conversations enable row level security;
alter table whitney_messages enable row level security;

create policy "whitney conversations: read own"
  on whitney_conversations for select
  using (profile_id = auth.uid());

create policy "whitney messages: read own"
  on whitney_messages for select
  using (
    exists (
      select 1 from whitney_conversations c
      where c.id = conversation_id and c.profile_id = auth.uid()
    )
  );

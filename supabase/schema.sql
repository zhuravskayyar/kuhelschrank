-- Shared Polychka fridge state and Telegram notification subscriptions.
-- All three tables are intentionally private to the service_role API key.
begin;

create table if not exists public.polychka_sync_state (
  household_id text primary key check (household_id = 'main'),
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.polychka_sync_members (
  telegram_id text primary key check (telegram_id ~ '^[0-9]{1,20}$'),
  username text not null default '',
  first_name text not null default '',
  chat_id text not null check (chat_id ~ '^-?[0-9]{1,20}$'),
  enabled boolean not null default true,
  last_notified_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.polychka_sync_config (
  id text primary key check (id = 'main'),
  sync_secret_hash text not null check (sync_secret_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.polychka_sync_state enable row level security;
alter table public.polychka_sync_members enable row level security;
alter table public.polychka_sync_config enable row level security;

revoke all on public.polychka_sync_state from public, anon, authenticated;
revoke all on public.polychka_sync_members from public, anon, authenticated;
revoke all on public.polychka_sync_config from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.polychka_sync_state to service_role;
grant select, insert, update, delete on public.polychka_sync_members to service_role;
grant select, insert, update, delete on public.polychka_sync_config to service_role;

insert into public.polychka_sync_state (household_id, revision, state)
values ('main', 0, '{"version":4,"items":[],"shopping":[],"receipts":[],"events":[],"settings":{"budget":0},"deleted":{"items":{},"shopping":{},"receipts":{},"events":{}}}'::jsonb)
on conflict (household_id) do nothing;

comment on table public.polychka_sync_state is 'One shared household inventory snapshot, revisioned for safe concurrent sync.';
comment on table public.polychka_sync_members is 'Telegram IDs allowed by the Polychka app; stores private chat IDs and reminder preference.';
comment on table public.polychka_sync_config is 'Private server-to-server sync authentication hash.';

notify pgrst, 'reload schema';
commit;

-- ===========================================================================
-- 0001_init.sql — initial schema, RLS, and storage for Insta Post Generator
-- Multi-tenant: every user-owned row carries user_id. Account-scoped tables
-- also carry account_id (FK instagram_accounts) and a denormalized user_id so
-- RLS policies stay simple and fast.
-- ===========================================================================

-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Enums ---------------------------------------------------------------------
do $$ begin
  create type ig_account_status as enum ('connected','disconnected','needs_reauth','ineligible');
exception when duplicate_object then null; end $$;

do $$ begin
  create type prompt_type as enum ('quote_idea','image_idea');
exception when duplicate_object then null; end $$;

do $$ begin
  create type post_status as enum ('queued','generating','qa_failed','published','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type post_origin as enum ('auto','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('trialing','active','past_due','canceled','incomplete');
exception when duplicate_object then null; end $$;

-- profiles ------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  plan        text not null default 'free',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row on signup.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- instagram_accounts --------------------------------------------------------
create table if not exists instagram_accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  ig_user_id       text,
  ig_username      text,
  page_id          text,
  encrypted_token  text,
  token_expiry     timestamptz,
  status           ig_account_status not null default 'disconnected',
  created_at       timestamptz not null default now()
);
create index if not exists idx_ig_accounts_user on instagram_accounts(user_id);

-- account_dna ---------------------------------------------------------------
create table if not exists account_dna (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null unique references instagram_accounts(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  persona           text,
  tone              text,
  audience          text,
  niche             text,
  content_pillars   text[] not null default '{}',
  visual_identity   jsonb not null default '{}'::jsonb,
  language          text default 'en',
  dos               text[] not null default '{}',
  donts             text[] not null default '{}',
  examples          text[] not null default '{}',
  default_post_time text,
  timezone          text default 'UTC',
  hashtag_strategy  text,
  updated_at        timestamptz not null default now()
);
create index if not exists idx_account_dna_user on account_dna(user_id);

-- prompt_library ------------------------------------------------------------
create table if not exists prompt_library (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references instagram_accounts(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          prompt_type not null,
  label         text not null,
  prompt_text   text not null,
  active         boolean not null default true,
  last_used_at  timestamptz,
  use_count     integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_prompt_library_account on prompt_library(account_id, type, active);
create index if not exists idx_prompt_library_user on prompt_library(user_id);

-- content_ideas -------------------------------------------------------------
create table if not exists content_ideas (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references instagram_accounts(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  idea             jsonb not null,
  source_prompt_id uuid references prompt_library(id) on delete set null,
  normalized_hash  text not null,
  status           text not null default 'new',
  created_at       timestamptz not null default now(),
  unique (account_id, normalized_hash)
);
create index if not exists idx_content_ideas_user on content_ideas(user_id);

-- posts ---------------------------------------------------------------------
create table if not exists posts (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references instagram_accounts(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  idea_id         uuid references content_ideas(id) on delete set null,
  headline        text,
  lines           text[] not null default '{}',
  caption         text,
  hashtags        text[] not null default '{}',
  image_url       text,
  status          post_status not null default 'queued',
  qa_score        numeric,
  qa_reasons      text[] not null default '{}',
  ig_media_id     text,
  scheduled_for   timestamptz,
  published_at    timestamptz,
  regen_attempts  integer not null default 0,
  origin          post_origin not null default 'auto',
  created_at      timestamptz not null default now()
);
create index if not exists idx_posts_account_status on posts(account_id, status);
create index if not exists idx_posts_user on posts(user_id);
create index if not exists idx_posts_scheduled on posts(scheduled_for) where status = 'queued';

-- post_metrics --------------------------------------------------------------
create table if not exists post_metrics (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  likes       integer,
  reach       integer,
  saves       integer,
  comments    integer,
  fetched_at  timestamptz not null default now()
);
create index if not exists idx_post_metrics_post on post_metrics(post_id);
create index if not exists idx_post_metrics_user on post_metrics(user_id);

-- jobs_log ------------------------------------------------------------------
create table if not exists jobs_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  account_id  uuid references instagram_accounts(id) on delete cascade,
  post_id     uuid references posts(id) on delete set null,
  stage       text,
  level       text not null default 'info',  -- info | warn | error
  message     text,
  context     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_jobs_log_user on jobs_log(user_id, created_at desc);

-- subscriptions -------------------------------------------------------------
create table if not exists subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  plan                     text,
  status                   subscription_status not null default 'incomplete',
  current_period_end       timestamptz,
  updated_at               timestamptz not null default now()
);
create index if not exists idx_subscriptions_user on subscriptions(user_id);

-- ===========================================================================
-- Row Level Security
-- Every table: owner (auth.uid() = user_id) can do everything to their rows.
-- The service role (worker) bypasses RLS entirely.
-- ===========================================================================
alter table profiles            enable row level security;
alter table instagram_accounts  enable row level security;
alter table account_dna         enable row level security;
alter table prompt_library      enable row level security;
alter table content_ideas       enable row level security;
alter table posts               enable row level security;
alter table post_metrics        enable row level security;
alter table jobs_log            enable row level security;
alter table subscriptions       enable row level security;

-- profiles: id IS the user id
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- generic owner policy via user_id for the rest
drop policy if exists "own rows" on instagram_accounts;
create policy "own rows" on instagram_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on account_dna;
create policy "own rows" on account_dna
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on prompt_library;
create policy "own rows" on prompt_library
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on content_ideas;
create policy "own rows" on content_ideas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on posts;
create policy "own rows" on posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on post_metrics;
create policy "own rows" on post_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- jobs_log: read-only for owners (writes come from the service-role worker)
drop policy if exists "own rows read" on jobs_log;
create policy "own rows read" on jobs_log
  for select using (auth.uid() = user_id);

drop policy if exists "own subscription" on subscriptions;
create policy "own subscription" on subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===========================================================================
-- Storage: private bucket for generated post images
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', false)
on conflict (id) do nothing;

-- Owners may read their own images. Convention: object path is prefixed with
-- the owner's user id, e.g. "<user_id>/<account_id>/<post_id>.png".
drop policy if exists "read own post images" on storage.objects;
create policy "read own post images" on storage.objects
  for select using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Writes to this bucket are performed by the service-role worker (bypasses RLS).

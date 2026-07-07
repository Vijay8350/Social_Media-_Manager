-- ===========================================================================
-- 0002_campaigns_schedule.sql — Campaigns feature + multi-slot scheduling
-- Run after 0001_init.sql (Supabase SQL editor). Idempotent.
-- ===========================================================================

-- Campaigns: themed runs of posts with their own prompt, cadence and references.
create table if not exists campaigns (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references instagram_accounts(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  topic             text,
  goal              text,
  tone              text,
  per_day           integer not null default 1,
  days              integer not null default 7,
  prompt            text,
  reference_images  text[] not null default '{}',
  status            text not null default 'active',  -- draft|active|paused|done
  posts_target      integer not null default 0,
  posts_done        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_campaigns_user on campaigns(user_id);
create index if not exists idx_campaigns_account on campaigns(account_id, status);

alter table campaigns enable row level security;
drop policy if exists "own rows" on campaigns;
create policy "own rows" on campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Link posts to the campaign that produced them (nullable; manual/auto posts have none).
alter table posts add column if not exists campaign_id uuid references campaigns(id) on delete set null;
create index if not exists idx_posts_campaign on posts(campaign_id);

-- Multi-slot scheduling + autonomous toggle on the account DNA.
alter table account_dna add column if not exists posting_slots text[] not null default '{}';
alter table account_dna add column if not exists autonomous boolean not null default true;

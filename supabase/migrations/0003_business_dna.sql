-- ===========================================================================
-- 0003_business_dna.sql — Business DNA: a per-account business profile built
-- automatically (DeepSeek) from the account's Instagram + website.
-- Run after 0002 (Supabase SQL editor). Idempotent.
--
-- Per-user DeepSeek settings (Settings page) need no migration: they live in
-- profiles.settings.llm, with the API key encrypted via TOKEN_ENCRYPTION_KEY.
-- ===========================================================================

create table if not exists business_dna (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null unique references instagram_accounts(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  business_name      text,
  website_url        text,
  summary            text,
  industry           text,
  offerings          text[] not null default '{}',
  usps               text[] not null default '{}',
  target_customers   text,
  brand_voice        text,
  tone               text,
  brand_values       text[] not null default '{}',
  key_messages       text[] not null default '{}',
  content_themes     text[] not null default '{}',
  ctas               text[] not null default '{}',
  keywords           text[] not null default '{}',
  visual_cues        text,
  language           text,
  dos                text[] not null default '{}',
  donts              text[] not null default '{}',
  -- When on, generation (manual, campaigns, autopilot) includes this profile.
  use_in_generation  boolean not null default true,
  -- What it was built from: { instagram: {...}, website: {...} } — no raw content.
  sources            jsonb not null default '{}'::jsonb,
  generated_at       timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists idx_business_dna_user on business_dna(user_id);

alter table business_dna enable row level security;
drop policy if exists "own rows" on business_dna;
create policy "own rows" on business_dna
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

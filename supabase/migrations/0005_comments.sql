-- ===========================================================================
-- 0005_comments.sql — Comments: AI auto-reply + moderation queue.
-- Run after 0001 (Supabase SQL editor). Idempotent.
--
-- The worker pulls new comments on each account's recent posts, DeepSeek
-- classifies each (positive / question / neutral / bad) and drafts a reply in
-- the account's voice. Bad comments are hidden on Instagram (if moderation is
-- on) and queued here for review; replies are sent automatically or after
-- approval, per account.
-- ===========================================================================

-- Per-account settings. No row = comments aren't monitored for that account.
create table if not exists comment_settings (
  account_id         uuid primary key references instagram_accounts(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  -- off: no replies · review: AI drafts, a person approves · auto: send drafts automatically
  reply_mode         text not null default 'review' check (reply_mode in ('off', 'review', 'auto')),
  -- hide comments the AI flags as bad (they're queued for review either way)
  auto_hide          boolean not null default true,
  daily_reply_limit  integer not null default 30 check (daily_reply_limit between 0 and 200),
  last_checked_at    timestamptz,
  last_error         text,
  updated_at         timestamptz not null default now()
);
create index if not exists idx_comment_settings_user on comment_settings(user_id);

create table if not exists ig_comments (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references instagram_accounts(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  ig_comment_id   text not null,
  ig_media_id     text not null,
  media_permalink text,
  media_caption   text,
  author          text,
  text            text not null,
  commented_at    timestamptz,
  -- AI review: verdict positive|question|neutral|bad; category set for bad ones
  verdict         text,
  category        text,
  reason          text,
  confidence      numeric,
  -- new → draft | replying → replied | done | flagged → approved | reviewed | deleted | error
  status          text not null default 'new',
  hidden          boolean not null default false,
  reply_text      text,
  reply_ig_id     text,
  replied_at      timestamptz,
  reviewed_at     timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, ig_comment_id)
);
create index if not exists idx_ig_comments_user on ig_comments(user_id);
create index if not exists idx_ig_comments_account_status on ig_comments(account_id, status);
create index if not exists idx_ig_comments_replied on ig_comments(account_id, replied_at) where status = 'replied';

-- RLS: owners only, and only for Instagram accounts they own (see 0004).
alter table comment_settings enable row level security;
alter table ig_comments enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['comment_settings', 'ig_comments'] loop
    execute format('drop policy if exists "own rows" on public.%1$I', t);
    execute format(
      'create policy "own rows" on public.%1$I for all
         using (auth.uid() = user_id)
         with check (
           auth.uid() = user_id
           and exists (
             select 1 from public.instagram_accounts a
             where a.id = %1$I.account_id and a.user_id = auth.uid()
           )
         )',
      t
    );
  end loop;
end $$;

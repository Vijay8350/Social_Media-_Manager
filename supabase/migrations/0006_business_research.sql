-- ===========================================================================
-- 0006_business_research.sql — Business DNA "deep research".
-- Run after 0003 (Supabase SQL editor). Idempotent.
--
-- Building a Business DNA is now a background job: research the sources
-- (Instagram profile, captions, customer comments; a deep website crawl),
-- extract evidence-backed facts, then write the DNA from that research only and
-- fact-check it. The web app queues a run on the row; the worker picks it up and
-- records progress here. The previous DNA stays in place until a run succeeds.
-- ===========================================================================

alter table business_dna add column if not exists research_status text not null default 'idle';
alter table business_dna drop constraint if exists business_dna_research_status_check;
alter table business_dna add constraint business_dna_research_status_check
  check (research_status in ('idle', 'queued', 'researching', 'analyzing', 'done', 'error'));

-- What was asked for: { website_url, include_instagram, requested_at }
alter table business_dna add column if not exists research_request jsonb not null default '{}'::jsonb;
-- Step log shown while it runs: [{ at, step, detail, level }]
alter table business_dna add column if not exists research_progress jsonb not null default '[]'::jsonb;
-- The research dossier: evidence-backed facts, voice samples, customer signals, gaps, stats
alter table business_dna add column if not exists research_notes jsonb;
alter table business_dna add column if not exists research_error text;
alter table business_dna add column if not exists research_started_at timestamptz;

create index if not exists idx_business_dna_research_queue
  on business_dna(research_status, updated_at)
  where research_status in ('queued', 'researching', 'analyzing');

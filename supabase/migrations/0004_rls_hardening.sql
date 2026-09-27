-- ===========================================================================
-- 0004_rls_hardening.sql — tighten Row Level Security.
-- Run after 0001 (Supabase SQL editor). Idempotent; tables from 0002/0003 that
-- don't exist yet are skipped, so re-run it after applying those.
--
-- 1) subscriptions and post_metrics become read-only for users. Only the Stripe
--    webhook and the worker write them, via the service role (bypasses RLS).
--    Before, a user could set their own subscription to status = 'active'
--    (free autopilot past the billing gate) or point stripe_customer_id at
--    another customer's Stripe id and open that customer's billing portal.
--
-- 2) Rows that reference an Instagram account must reference one the user owns.
--    Before, only the row's own user_id was checked, so a user could insert rows
--    under someone else's account_id — e.g. take the single account_dna /
--    business_dna row for an account so its owner could never save theirs.
-- ===========================================================================

drop policy if exists "own subscription" on subscriptions;
drop policy if exists "own subscription read" on subscriptions;
create policy "own subscription read" on subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "own rows" on post_metrics;
drop policy if exists "own rows read" on post_metrics;
create policy "own rows read" on post_metrics
  for select using (auth.uid() = user_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'account_dna', 'prompt_library', 'content_ideas', 'posts', 'campaigns', 'business_dna'
  ] loop
    continue when to_regclass('public.' || t) is null;
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

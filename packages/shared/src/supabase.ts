import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the worker / trusted server contexts.
 *
 * WARNING: the service role bypasses Row Level Security. Every query made with
 * this client MUST be explicitly scoped by user_id (and account_id where
 * applicable). RLS does not protect you here.
 *
 * The browser/SSR clients live in apps/web/lib/supabase (built on @supabase/ssr)
 * and DO rely on RLS via the user's auth session.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "createServiceRoleClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

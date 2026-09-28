/**
 * True when a Supabase/PostgREST error means a migration hasn't been applied:
 * undefined column (42703), undefined table (42P01), or a table/column missing
 * from PostgREST's schema cache (PGRST205 / PGRST204).
 */
export function isMissingSchema(err: { code?: string } | null | undefined): boolean {
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(err?.code ?? "");
}

export const MIGRATION_0002_HINT =
  "Database update needed: run supabase/migrations/0002_campaigns_schedule.sql in the Supabase SQL editor.";

export const MIGRATION_0003_HINT =
  "Database update needed: run supabase/migrations/0003_business_dna.sql in the Supabase SQL editor.";

export const MIGRATION_0005_HINT =
  "Database update needed: run supabase/migrations/0005_comments.sql in the Supabase SQL editor.";

export const MIGRATION_0006_HINT =
  "Database update needed: run supabase/migrations/0006_business_research.sql in the Supabase SQL editor.";

import {
  createServiceRoleClient,
  decryptSecret,
  getLLMProviderForUser,
  runBusinessResearch,
  type BusinessDna,
  type ResearchEvent,
} from "@insta/shared";

/**
 * Business DNA deep research runner. The web app queues a run by setting
 * business_dna.research_status = 'queued'; this poll (every 15 s) claims one,
 * runs the research with live progress, and writes the result. Service role,
 * so every query is scoped by user_id.
 */

const STALE_MS = 15 * 60_000;
const MAX_LOG = 60;

export async function processResearchQueue(): Promise<number> {
  const svc = createServiceRoleClient();

  // A run that died mid-way (worker restart) would stay "running" forever.
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { error: staleErr } = await svc
    .from("business_dna")
    .update({ research_status: "error", research_error: "The research was interrupted — run it again." })
    .in("research_status", ["researching", "analyzing"])
    .lt("research_started_at", staleBefore);
  if (staleErr) {
    // Columns missing until migration 0006 is applied — nothing to do yet.
    if (!/research_/.test(staleErr.message)) console.error("[research] stale check failed:", staleErr.message);
    return 0;
  }

  const { data: next } = await svc
    .from("business_dna")
    .select("id, account_id, user_id, research_request")
    .eq("research_status", "queued")
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!next) return 0;

  // Claim it (another poll or worker may race us).
  const startedAt = new Date().toISOString();
  const firstLog: ResearchEvent[] = [{ at: startedAt, step: "Picked up by the research worker" }];
  const { data: claimed } = await svc
    .from("business_dna")
    .update({ research_status: "researching", research_started_at: startedAt, research_progress: firstLog, research_error: null })
    .eq("id", next.id)
    .eq("user_id", next.user_id)
    .eq("research_status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return 0;

  const row = next as Pick<BusinessDna, "id" | "account_id" | "user_id" | "research_request">;
  const scope = <T extends { eq: (c: string, v: string) => T }>(q: T) => q.eq("id", row.id).eq("user_id", row.user_id);
  const log: ResearchEvent[] = [...firstLog];
  let status: "researching" | "analyzing" = "researching";

  const fail = async (message: string) => {
    log.push({ at: new Date().toISOString(), step: "Research failed", detail: message, level: "warn" });
    await scope(
      svc.from("business_dna").update({ research_status: "error", research_error: message, research_progress: log.slice(-MAX_LOG) }),
    );
  };

  try {
    const { data: account } = await svc
      .from("instagram_accounts")
      .select("id, ig_user_id, encrypted_token")
      .eq("id", row.account_id)
      .eq("user_id", row.user_id)
      .maybeSingle();
    if (!account) {
      await fail("The Instagram account no longer exists.");
      return 1;
    }

    const req = row.research_request ?? {};
    const llm = await getLLMProviderForUser(svc, row.user_id);
    let instagram: { igUserId: string; token: string } | null = null;
    if (req.include_instagram && account.ig_user_id && account.encrypted_token) {
      instagram = { igUserId: account.ig_user_id, token: decryptSecret(account.encrypted_token) };
    }

    const result = await runBusinessResearch({
      llm,
      instagram,
      websiteUrl: req.website_url ?? null,
      onProgress: async (e) => {
        if (e.phase) status = e.phase;
        log.push({ at: new Date().toISOString(), step: e.step, detail: e.detail ?? null, level: e.level ?? "info" });
        await scope(svc.from("business_dna").update({ research_status: status, research_progress: log.slice(-MAX_LOG) }));
      },
    });

    const now = new Date().toISOString();
    const { error } = await scope(
      svc.from("business_dna").update({
        ...result.dna,
        website_url: result.websiteUrl,
        sources: result.sources,
        research_notes: result.dossier,
        research_status: "done",
        research_error: null,
        research_progress: log.slice(-MAX_LOG),
        generated_at: now,
        updated_at: now,
      }),
    );
    if (error) await fail(`Couldn't save the result: ${error.message}`);
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Research failed");
  }
  return 1;
}

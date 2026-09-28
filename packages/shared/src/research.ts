import { buildBusinessSourceText } from "./business";
import type { LLMProvider } from "./providers/llm";
import {
  fetchInstagramMedia,
  fetchInstagramProfile,
  fetchRecentComments,
  type InstagramMedia,
  type InstagramProfile,
  type MediaComment,
} from "./providers/instagram";
import type { BusinessDnaParsed } from "./schemas";
import type { BusinessDnaSources, ResearchDossier, ResearchEvent, ResearchFact } from "./types";
import { crawlWebsite, normalizeWebsiteUrl, type WebsiteSnapshot } from "./website";

/**
 * Business DNA deep research. Research first, then write:
 *   1. collect — Instagram profile + 50 captions + customer comments; a deep
 *      website crawl (about, products, pricing, FAQ, reviews, policies, …)
 *   2. extract — per source excerpt, concrete facts with verbatim evidence
 *   3. synthesize — the Business DNA from the research dossier only
 *   4. verify — fact-check the draft against the dossier
 * Pure orchestration (no DB): callers persist progress and the result.
 */

const CAPTIONS = 50;
const COMMENT_POSTS = 12;
const MAX_COMMENTS = 80;
const EXCERPT_CHARS = 9000;
const EXTRACT_CONCURRENCY = 3;
const MAX_FACTS = 150;

export interface BusinessResearchInput {
  llm: LLMProvider;
  /** Include Instagram (profile, captions, comments). */
  instagram: { igUserId: string; token: string } | null;
  /** Website to research; defaults to the link in the Instagram bio. */
  websiteUrl: string | null;
  onProgress?: (e: Omit<ResearchEvent, "at"> & { phase?: "researching" | "analyzing" }) => unknown;
  /** Epoch ms after which no new AI calls are started. */
  deadline?: number;
}

export interface BusinessResearchResult {
  dna: BusinessDnaParsed;
  dossier: ResearchDossier;
  sources: BusinessDnaSources;
  websiteUrl: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240);

/** Split text into chunks of at most `max` chars, on line boundaries. */
export function chunkText(text: string, max = EXCERPT_CHARS): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const piece = line.length > max ? line.slice(0, max) : line;
    if (cur && cur.length + piece.length + 1 > max) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + piece;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Merge per-excerpt findings: de-duplicate facts and samples, cap sizes. */
export function mergeFindings(
  parts: Array<{ source: string; facts: Omit<ResearchFact, "source">[]; voice_samples: string[]; customer_signals: string[] }>,
): Pick<ResearchDossier, "facts" | "voice_samples" | "customer_signals"> {
  const facts: ResearchFact[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    for (const f of p.facts) {
      const key = norm(f.fact);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      facts.push({ ...f, source: p.source });
    }
  }
  const uniq = (xs: string[], cap: number) => {
    const s = new Set<string>();
    return xs.filter((x) => {
      const k = norm(x);
      if (!k || s.has(k)) return false;
      s.add(k);
      return true;
    }).slice(0, cap);
  };
  return {
    facts: facts.slice(0, MAX_FACTS),
    voice_samples: uniq(parts.flatMap((p) => p.voice_samples), 15),
    customer_signals: uniq(parts.flatMap((p) => p.customer_signals), 15),
  };
}

/** The dossier as prompt text — the only thing synthesis and fact-checking see. */
export function dossierText(d: Pick<ResearchDossier, "facts" | "voice_samples" | "customer_signals">): string {
  const out = ["## Research dossier — facts found in the sources, each with its evidence"];
  const byCat = new Map<string, ResearchFact[]>();
  for (const f of d.facts) byCat.set(f.category, [...(byCat.get(f.category) ?? []), f]);
  let n = 0;
  for (const [cat, facts] of byCat) {
    out.push(`\n### ${cat}`);
    for (const f of facts) {
      n++;
      out.push(`[F${n}] ${f.fact}${f.evidence ? ` — "${f.evidence}"` : ""} (${f.source})`);
    }
  }
  if (!d.facts.length) out.push("(no facts found)");
  if (d.voice_samples.length) out.push("\n## How the brand writes (verbatim samples)", ...d.voice_samples.map((v) => `- "${v}"`));
  if (d.customer_signals.length) out.push("\n## What customers say / ask", ...d.customer_signals.map((c) => `- ${c}`));
  return out.join("\n").slice(0, 30_000);
}

/** Run `fn` over items with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runBusinessResearch(input: BusinessResearchInput): Promise<BusinessResearchResult> {
  const started = Date.now();
  const { llm } = input;
  const deadline = input.deadline ?? started + 8 * 60_000;
  const progress = async (e: Parameters<NonNullable<BusinessResearchInput["onProgress"]>>[0]) => {
    await input.onProgress?.(e);
  };
  const sources: BusinessDnaSources = {};
  const excerpts: Array<{ source: string; text: string }> = [];
  let captions = 0;
  let commentCount = 0;

  // ---- 1) Collect ----------------------------------------------------------
  await progress({ phase: "researching", step: "Research started" });

  let profile: InstagramProfile | null = null;
  if (input.instagram) {
    const { igUserId, token } = input.instagram;
    await progress({ step: "Reading the Instagram profile and recent posts" });
    try {
      let media: InstagramMedia[];
      [profile, media] = await Promise.all([
        fetchInstagramProfile(igUserId, token),
        fetchInstagramMedia(igUserId, token, CAPTIONS),
      ]);
      captions = media.filter((m) => m.caption?.trim()).length;
      sources.instagram = { username: profile.username, posts_analyzed: captions, followers: profile.followers };
      const text = buildBusinessSourceText({ instagram: { ...profile, posts: media } });
      for (const [i, t] of chunkText(text).entries()) excerpts.push({ source: `instagram profile & captions${i ? ` (${i + 1})` : ""}`, text: t });
      await progress({ step: `Instagram: @${profile.username}`, detail: `${captions} captions, ${profile.followers ?? "?"} followers` });
    } catch (err) {
      sources.instagram = { username: null, posts_analyzed: 0, followers: null, error: errText(err) };
      await progress({ step: "Instagram profile couldn't be read", detail: errText(err), level: "warn" });
    }

    if (profile) {
      await progress({ step: "Reading what customers comment" });
      try {
        const own = profile.username.toLowerCase();
        const comments: MediaComment[] = (
          await fetchRecentComments(igUserId, token, { since: new Date(Date.now() - 365 * 864e5), mediaLimit: COMMENT_POSTS, perMedia: 20 })
        )
          .filter((c) => c.author?.toLowerCase() !== own)
          .slice(0, MAX_COMMENTS);
        commentCount = comments.length;
        if (comments.length) {
          const text = ["## Comments customers left on recent posts", ...comments.map((c) => `- @${c.author ?? "someone"}: ${c.text.replace(/\s+/g, " ").slice(0, 300)}`)].join("\n");
          for (const t of chunkText(text)) excerpts.push({ source: "instagram comments", text: t });
        }
        await progress({ step: `Customer comments: ${comments.length}` });
      } catch (err) {
        await progress({ step: "Comments skipped", detail: errText(err), level: "warn" });
      }
    }
  }

  const websiteInput = input.websiteUrl ?? profile?.website ?? null;
  let website: WebsiteSnapshot | null = null;
  if (websiteInput) {
    const url = normalizeWebsiteUrl(websiteInput);
    await progress({ step: `Crawling the website ${new URL(url).hostname}`, detail: "about, products, pricing, FAQ, reviews, policies…" });
    try {
      website = await crawlWebsite(url, { deep: true });
      sources.website = { url: website.url, pages: website.pages.map((p) => p.url) };
      for (const page of website.pages) {
        const text = buildBusinessSourceText({ website: { url: website.url, pages: [page] } });
        const path = new URL(page.url).pathname || "/";
        for (const t of chunkText(text)) excerpts.push({ source: `website: ${path}`, text: t });
      }
      const chars = website.pages.reduce((n, p) => n + p.text.length, 0);
      await progress({ step: `Website: ${website.pages.length} page${website.pages.length === 1 ? "" : "s"} read`, detail: website.pages.map((p) => new URL(p.url).pathname).join(", ") });
      if (chars < 300) {
        await progress({ step: "Very little readable text on the website", detail: "It may be built with JavaScript — the result leans on Instagram.", level: "warn" });
      }
    } catch (err) {
      sources.website = { url, pages: [], error: errText(err) };
      await progress({ step: "Website couldn't be read", detail: errText(err), level: "warn" });
    }
  }

  if (!excerpts.length) {
    throw new Error("Nothing to research — add a website URL or include a connected Instagram account.");
  }

  // ---- 2) Extract facts ------------------------------------------------------
  await progress({ phase: "analyzing", step: `Extracting facts from ${excerpts.length} source excerpt${excerpts.length === 1 ? "" : "s"}` });
  const parts = await mapLimit(excerpts, EXTRACT_CONCURRENCY, async (ex) => {
    try {
      const r = await llm.extractResearchFacts(ex.source, ex.text, { deadline });
      await progress({ step: `✓ ${ex.source}`, detail: `${r.facts.length} facts` });
      return { source: ex.source, ...r };
    } catch (err) {
      await progress({ step: `✗ ${ex.source}`, detail: errText(err), level: "warn" });
      return null;
    }
  });
  const found = parts.filter((p): p is NonNullable<typeof p> => p !== null);
  if (!found.length) throw new Error("The AI couldn't read any of the sources — try again in a minute.");
  const merged = mergeFindings(found);
  if (!merged.facts.length) throw new Error("The research found no concrete facts about the business in these sources.");
  await progress({ step: `Research complete: ${merged.facts.length} facts`, detail: `${merged.voice_samples.length} voice samples, ${merged.customer_signals.length} customer signals` });

  // ---- 3) Write from the research only; 4) fact-check ------------------------
  const text = dossierText(merged);
  await progress({ step: "Writing the Business DNA from the research" });
  const { gaps, ...draft } = await llm.synthesizeBusinessDna(text, { deadline });

  await progress({ step: "Fact-checking every field against the research" });
  let dna: BusinessDnaParsed = draft;
  try {
    dna = await llm.verifyBusinessDna(text, draft, { deadline });
  } catch (err) {
    await progress({ step: "Fact-check didn't finish — keeping the draft written from the research", detail: errText(err), level: "warn" });
  }

  const dossier: ResearchDossier = {
    ...merged,
    gaps,
    stats: {
      captions,
      comments: commentCount,
      pages: website?.pages.length ?? 0,
      excerpts: excerpts.length,
      facts: merged.facts.length,
      seconds: Math.round((Date.now() - started) / 1000),
    },
  };
  await progress({ step: "Done", detail: `${dossier.stats.seconds}s` });
  return { dna, dossier, sources, websiteUrl: website?.url ?? sources.website?.url ?? null };
}

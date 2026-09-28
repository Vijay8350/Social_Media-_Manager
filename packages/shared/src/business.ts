import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountDna, BusinessDna } from "./types";
import type { WebsiteSnapshot } from "./website";

/** Raw inputs for a Business DNA analysis. */
export interface BusinessSourceInput {
  instagram?: {
    username: string;
    name: string | null;
    biography: string | null;
    website: string | null;
    followers: number | null;
    mediaCount: number | null;
    posts: Array<{
      caption: string | null;
      likes: number | null;
      comments: number | null;
      timestamp: string;
    }>;
  } | null;
  website?: WebsiteSnapshot | null;
}

const MAX_CAPTION = 500;
const TOP_POSTS = 5;

/** Flatten Instagram + website data into the analysis prompt's source text. */
export function buildBusinessSourceText(input: BusinessSourceInput): string {
  const out: string[] = [];
  const ig = input.instagram;
  if (ig) {
    out.push("## Instagram profile");
    out.push(`Username: @${ig.username}`);
    if (ig.name) out.push(`Name: ${ig.name}`);
    if (ig.biography) out.push(`Bio: ${ig.biography}`);
    if (ig.website) out.push(`Link in bio: ${ig.website}`);
    if (ig.followers != null) out.push(`Followers: ${ig.followers}`);
    if (ig.mediaCount != null) out.push(`Total posts: ${ig.mediaCount}`);

    const posts = ig.posts.filter((p) => p.caption?.trim());
    if (posts.length) {
      const engagement = (p: (typeof posts)[number]) => (p.likes ?? 0) + (p.comments ?? 0);
      const top = new Set([...posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, TOP_POSTS));
      out.push("", `## Recent Instagram captions (newest first; ★ = top ${TOP_POSTS} by engagement)`);
      for (const p of posts) {
        const caption = p.caption!.replace(/\s+/g, " ").trim().slice(0, MAX_CAPTION);
        const stats = `${p.likes ?? "?"} likes, ${p.comments ?? "?"} comments`;
        out.push(`- ${top.has(p) ? "★ " : ""}[${p.timestamp.slice(0, 10)} · ${stats}] ${caption}`);
      }
    }
  }

  const site = input.website;
  if (site?.pages.length) {
    for (const page of site.pages) {
      out.push("", `## Website page: ${page.url}`);
      if (page.title) out.push(`Title: ${page.title}`);
      if (page.description) out.push(`Description: ${page.description}`);
      if (page.headings.length) out.push(`Headings: ${page.headings.join(" | ")}`);
      if (page.structuredData) out.push(`Structured data: ${page.structuredData}`);
      if (page.text) out.push(`Text:\n${page.text}`);
    }
  }
  return out.join("\n").trim();
}

export type AccountDnaPatch = Partial<
  Pick<
    AccountDna,
    | "persona"
    | "tone"
    | "audience"
    | "niche"
    | "content_pillars"
    | "language"
    | "dos"
    | "donts"
    | "hashtag_strategy"
    | "visual_identity"
  >
>;

const mergeUnique = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * Map a Business DNA onto Account DNA fields ("Apply to Account DNA").
 * Voice/audience/niche/pillars/language are replaced when the business has a
 * value; do's/don'ts are merged; hashtag strategy and visual style are only
 * filled in when the account doesn't have them yet.
 */
export function businessToAccountDnaPatch(
  b: BusinessDna,
  existing: AccountDna | null,
): { patch: AccountDnaPatch; fields: string[] } {
  const patch: AccountDnaPatch = {};
  const fields: string[] = [];
  const set = <K extends keyof AccountDnaPatch>(key: K, value: AccountDnaPatch[K], label: string) => {
    patch[key] = value;
    fields.push(label);
  };

  if (b.brand_voice) set("persona", b.brand_voice, "persona");
  if (b.tone) set("tone", b.tone, "tone");
  if (b.target_customers) set("audience", b.target_customers, "audience");
  if (b.industry) set("niche", b.business_name ? `${b.industry} — ${b.business_name}` : b.industry, "niche");
  if (b.content_themes.length) set("content_pillars", b.content_themes, "content pillars");
  if (b.language) set("language", b.language, "language");
  if (b.dos.length) set("dos", mergeUnique(existing?.dos ?? [], b.dos), "do's");
  if (b.donts.length) set("donts", mergeUnique(existing?.donts ?? [], b.donts), "don'ts");
  if (b.keywords.length && !existing?.hashtag_strategy) {
    set(
      "hashtag_strategy",
      `Mix broad, medium and niche hashtags built around: ${b.keywords.slice(0, 12).join(", ")}.`,
      "hashtag strategy",
    );
  }
  if (b.visual_cues && !existing?.visual_identity?.style) {
    set("visual_identity", { ...(existing?.visual_identity ?? {}), style: b.visual_cues }, "visual style");
  }
  return { patch, fields };
}

/**
 * The account's Business DNA if it's switched on for generation, else null.
 * Also null when migration 0003 hasn't been applied, so generation never breaks
 * on it. Scoped by user_id for service-role callers.
 */
export async function getActiveBusinessDna(
  client: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<BusinessDna | null> {
  const { data, error } = await client
    .from("business_dna")
    .select("*")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .eq("use_in_generation", true)
    // A row exists as soon as research is queued; only use one that's been built.
    .not("generated_at", "is", null)
    .maybeSingle();
  if (error) return null;
  return (data as BusinessDna | null) ?? null;
}

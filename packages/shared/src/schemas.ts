import { z } from "zod";

/** Stage 1 output — a single fresh content idea. */
export const generatedIdeaSchema = z.object({
  theme: z.string().min(1),
  angle: z.string().min(1),
  format: z.string().min(1),
  /** One-line summary of the idea; used to de-duplicate against past ideas. */
  summary: z.string().min(1),
});
export type GeneratedIdea = z.infer<typeof generatedIdeaSchema>;

/** Stage 2 output — the on-image text + caption + hashtags. */
export const generatedContentSchema = z.object({
  headline: z.string().min(1),
  lines: z.array(z.string().min(1)).min(1).max(8),
  caption: z.string().min(1),
  hashtags: z.array(z.string().min(1)).min(1).max(30),
});
export type GeneratedContentParsed = z.infer<typeof generatedContentSchema>;

/** Coerce whatever the model put in a text slot (string, number, {name, description}) to a string. */
function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v && typeof v === "object") {
    return Object.values(v)
      .filter((x) => typeof x === "string" || typeof x === "number")
      .join(" — ");
  }
  return "";
}

const optText = (max: number) =>
  z.preprocess(
    (v) => (v == null ? null : toText(v)),
    z
      .string()
      .nullable()
      .transform((s) => s?.trim().slice(0, max) || null),
  );

const textList = z.preprocess(
  (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map(toText),
  z
    .array(z.string())
    .transform((a) =>
      [...new Set(a.map((s) => s.trim().slice(0, 300)).filter(Boolean))].slice(0, 12),
    ),
);

/**
 * Business DNA analysis output (DeepSeek, from Instagram + website text).
 * Lenient on shape — models sometimes return a string for a list or objects for
 * list items — but always normalizes to trimmed, capped, de-duplicated values.
 */
export const businessDnaSchema = z.object({
  business_name: optText(120),
  summary: z.preprocess(toText, z.string().trim().min(1).transform((s) => s.slice(0, 1200))),
  industry: optText(160),
  offerings: textList,
  usps: textList,
  target_customers: optText(600),
  brand_voice: optText(600),
  tone: optText(200),
  brand_values: textList,
  key_messages: textList,
  content_themes: textList,
  ctas: textList,
  keywords: textList,
  visual_cues: optText(600),
  language: optText(60),
  dos: textList,
  donts: textList,
});
export type BusinessDnaParsed = z.infer<typeof businessDnaSchema>;

export const COMMENT_BAD_CATEGORIES = [
  "spam",
  "scam",
  "abuse",
  "hate",
  "sexual",
  "self_promotion",
  "other",
] as const;

/**
 * Comment review output (DeepSeek): one verdict per comment + an optional reply.
 * Lenient on shape, strict on values; anything unusable is dropped by the caller.
 */
export const commentReviewSchema = z.object({
  results: z.array(
    z.object({
      id: z.preprocess(toText, z.string().min(1)),
      verdict: z.preprocess(
        (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
        z.enum(["positive", "question", "neutral", "bad"]),
      ),
      category: z.preprocess(
        (v) => (typeof v === "string" ? v.toLowerCase().trim().replace(/[\s-]+/g, "_") : null),
        z.enum(COMMENT_BAD_CATEGORIES).nullable().catch("other"),
      ),
      reason: optText(200),
      confidence: z.preprocess((v) => Number(v), z.number().min(0).max(1).catch(0)),
      reply: optText(300),
    }),
  ),
});
export type CommentReviewParsed = z.infer<typeof commentReviewSchema>["results"][number];

const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|in|io|co|me|ly|link|app|shop|store|xyz|info|biz)\b)/i;
const CONTACTISH = /(\S+@\S+\.\S+|\+?\d[\d\s().-]{7,}\d)/;

/**
 * Make a model-drafted comment reply safe to post publicly, or null. Replies
 * with links, emails or phone numbers are dropped outright (a comment could
 * have talked the model into advertising something); hashtags and @mentions are
 * stripped; overlong replies are dropped rather than cut mid-sentence.
 */
export function sanitizeCommentReply(reply: string | null | undefined): string | null {
  if (!reply) return null;
  if (LINKISH.test(reply) || CONTACTISH.test(reply)) return null;
  const clean = reply
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(/(^|\s)@[\w.]+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([!?.,:;])/g, "$1")
    .trim();
  if (!clean || clean.length > 300) return null;
  return clean;
}

import { createHash } from "node:crypto";

/**
 * Normalized hash of an idea's essence, used for per-account de-duplication so
 * the pipeline never repeats a post. Lowercases, strips punctuation, and
 * collapses whitespace before hashing so trivially-different phrasings of the
 * same idea collide.
 */
export function normalizeHash(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

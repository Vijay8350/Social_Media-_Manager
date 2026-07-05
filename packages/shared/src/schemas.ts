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

import { z } from "zod";
import type { AccountDna } from "../types";

/** Quality-gate verdict. */
export const qualityVerdictSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).default([]),
  rendered_text: z.string().optional(),
});
export type QualityVerdictParsed = z.infer<typeof qualityVerdictSchema>;

export interface VisionProvider {
  /**
   * Read the text actually rendered in the image and score it against the
   * intended text. Text fidelity is the most important criterion — fail on any
   * garbled, misspelled, missing, duplicated, or unreadable text.
   */
  scoreImage(
    image: { bytes: Buffer; mimeType: string },
    intended: { headline: string; lines: string[] },
    dna: AccountDna | null,
  ): Promise<QualityVerdictParsed>;
}

function buildVisionPrompt(
  intended: { headline: string; lines: string[] },
  dna: AccountDna | null,
): string {
  const intendedText = [intended.headline, ...intended.lines]
    .filter(Boolean)
    .join("\n");
  const donts = dna?.donts?.length ? `\nBrand don'ts: ${dna.donts.join("; ")}.` : "";
  return `You are a strict quality inspector for an unattended Instagram auto-poster. Inspect the attached image.

The text that was SUPPOSED to be rendered on it is:
"""
${intendedText}
"""

Evaluate, in order of importance:
1. TEXT FIDELITY (most important): read the text actually visible in the image. It must match the intended text exactly — fail on any misspelling, garbled/duplicated/missing words, or gibberish.
2. LEGIBILITY: text is sharp, high-contrast, and easily readable.
3. ON-BRAND / ON-TOPIC: matches the intended vibe.${donts}
4. SAFETY: no NSFW, offensive, nonsensical, or broken/artifact content.

Be conservative — when uncertain, FAIL. Respond ONLY with JSON:
{ "pass": boolean, "score": number (0-100), "reasons": string[], "rendered_text": string }`;
}

class GeminiVisionProvider implements VisionProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    this.apiKey = key;
    this.model = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
  }

  async scoreImage(
    image: { bytes: Buffer; mimeType: string },
    intended: { headline: string; lines: string[] },
    dna: AccountDna | null,
  ): Promise<QualityVerdictParsed> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: buildVisionPrompt(intended, dna) },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.bytes.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini vision ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini vision returned empty content");
      return qualityVerdictSchema.parse(JSON.parse(text));
    } finally {
      clearTimeout(timeout);
    }
  }
}

let cached: VisionProvider | null = null;

/** Returns the configured vision provider (Gemini). */
export function getVisionProvider(): VisionProvider {
  if (!cached) cached = new GeminiVisionProvider();
  return cached;
}

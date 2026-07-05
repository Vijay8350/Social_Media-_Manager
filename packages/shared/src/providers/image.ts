import type { AccountDna } from "../types";
import type { GeneratedContentParsed } from "../schemas";

/**
 * Image provider interface — generates the finished post image with the quote
 * text baked into the artwork. Swappable via env; default is Google Gemini.
 */
export interface GeneratedImage {
  /** Raw image bytes. */
  bytes: Buffer;
  /** MIME type, e.g. image/png. */
  mimeType: string;
}

export interface ImageProvider {
  generateImage(prompt: string): Promise<GeneratedImage>;
}

/** Build the image prompt from DNA visual identity + image-idea prompt + exact text to render. */
export function buildImagePrompt(
  dna: AccountDna | null,
  imageIdea: string | null,
  content: Pick<GeneratedContentParsed, "headline" | "lines">,
): string {
  const vi = dna?.visual_identity ?? {};
  const style = [
    vi.mood && `mood: ${vi.mood}`,
    vi.style && `style: ${vi.style}`,
    vi.palette?.length && `palette: ${vi.palette.join(", ")}`,
    vi.font && `font feel: ${vi.font}`,
    vi.layout && `layout: ${vi.layout}`,
  ]
    .filter(Boolean)
    .join("; ");

  const textBlock = [content.headline, ...content.lines]
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join("\n");

  return [
    "Create a square (1080x1080) Instagram quote graphic.",
    imageIdea ? `Scene/style direction: ${imageIdea}.` : "",
    style ? `Visual identity — ${style}.` : "",
    "Render the following text cleanly and legibly, spelled EXACTLY as written, well-composed and high-contrast against the background:",
    textBlock,
    "The text must be perfectly spelled, readable, and the focal point. No watermarks, no extra or garbled text.",
  ]
    .filter(Boolean)
    .join("\n");
}

class GeminiImageProvider implements ImageProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    this.apiKey = key;
    this.model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  }

  async generateImage(prompt: string): Promise<GeneratedImage> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini image ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
          };
        }>;
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.data);
      const b64 = imagePart?.inlineData?.data;
      if (!b64) throw new Error("Gemini returned no image data");
      return {
        bytes: Buffer.from(b64, "base64"),
        mimeType: imagePart?.inlineData?.mimeType || "image/png",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

let cached: ImageProvider | null = null;

/** Returns the configured image provider (Gemini). */
export function getImageProvider(): ImageProvider {
  if (!cached) cached = new GeminiImageProvider();
  return cached;
}

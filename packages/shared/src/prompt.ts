import type { AccountDna } from "./types";
import type { GeneratedIdea } from "./schemas";

/** Render the Account DNA into a system prompt that conditions every generation. */
export function buildDnaSystemPrompt(dna: AccountDna | null): string {
  if (!dna) {
    return "You are an expert Instagram content creator for a quote/aesthetic page. Keep output tight, original, and platform-ready.";
  }
  const vi = dna.visual_identity ?? {};
  const parts: string[] = [
    "You are the content engine for a specific Instagram quote/aesthetic account. Everything you produce must match this account's identity:",
  ];
  if (dna.persona) parts.push(`- Persona / voice: ${dna.persona}`);
  if (dna.tone) parts.push(`- Tone: ${dna.tone}`);
  if (dna.audience) parts.push(`- Audience: ${dna.audience}`);
  if (dna.niche) parts.push(`- Niche: ${dna.niche}`);
  if (dna.content_pillars?.length)
    parts.push(`- Content pillars: ${dna.content_pillars.join("; ")}`);
  if (dna.language) parts.push(`- Language: write in ${dna.language}`);
  const viBits = [vi.mood && `mood ${vi.mood}`, vi.style && `style ${vi.style}`, vi.font && `font ${vi.font}`, vi.layout && `layout ${vi.layout}`]
    .filter(Boolean)
    .join(", ");
  if (viBits) parts.push(`- Visual identity: ${viBits}`);
  if (dna.dos?.length) parts.push(`- Always: ${dna.dos.join("; ")}`);
  if (dna.donts?.length) parts.push(`- Never: ${dna.donts.join("; ")}`);
  if (dna.examples?.length)
    parts.push(`- Example posts to match the style:\n${dna.examples.map((e) => `  • ${e}`).join("\n")}`);
  if (dna.hashtag_strategy) parts.push(`- Hashtag strategy: ${dna.hashtag_strategy}`);
  parts.push(
    "Respect these constraints strictly. Respond ONLY with valid JSON matching the requested shape — no markdown, no commentary.",
  );
  return parts.join("\n");
}

/** Stage 1 user prompt: ask for one fresh idea, avoiding recent ones. */
export function buildIdeaUserPrompt(
  promptText: string,
  recentSummaries: string[],
): string {
  const avoid = recentSummaries.length
    ? `\n\nDo NOT repeat or closely resemble any of these recent ideas:\n${recentSummaries.map((s) => `- ${s}`).join("\n")}`
    : "";
  return `Generate ONE fresh post idea based on this angle/seed: "${promptText}".${avoid}

Respond with JSON: { "theme": string, "angle": string, "format": string, "summary": string }
- theme: the core subject
- angle: the specific take/hook
- format: e.g. "single quote", "list", "this vs that"
- summary: one concise sentence capturing the idea (used to avoid duplicates)`;
}

/** Stage 2 user prompt: turn the idea into on-image text + caption + hashtags. */
export function buildContentUserPrompt(idea: GeneratedIdea): string {
  return `Turn this idea into a finished post.
Idea: theme="${idea.theme}", angle="${idea.angle}", format="${idea.format}".

Respond with JSON: { "headline": string, "lines": string[], "caption": string, "hashtags": string[] }
- headline: the main line rendered ON the image (short, punchy)
- lines: 1-6 supporting lines rendered on the image (keep each short)
- caption: the Instagram caption in the account's voice/language
- hashtags: a mix of broad/medium/niche tags per the hashtag strategy (with or without '#')`;
}

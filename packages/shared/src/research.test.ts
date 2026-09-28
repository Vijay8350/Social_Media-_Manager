import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInstagramMedia, fetchInstagramProfile, fetchRecentComments } from "./providers/instagram";
import type { LLMProvider } from "./providers/llm";
import { chunkText, mergeFindings, runBusinessResearch } from "./research";
import type { BusinessDnaParsed } from "./schemas";
import { crawlWebsite } from "./website";

vi.mock("./providers/instagram", () => ({
  fetchInstagramProfile: vi.fn(),
  fetchInstagramMedia: vi.fn(),
  fetchRecentComments: vi.fn(),
}));
vi.mock("./website", async (orig) => ({ ...(await orig<typeof import("./website")>()), crawlWebsite: vi.fn() }));

const DNA: BusinessDnaParsed = {
  business_name: "Glowfinch",
  summary: "Handmade evil-eye jewellery.",
  industry: "jewellery",
  offerings: ["evil-eye bracelets"],
  usps: [],
  target_customers: null,
  brand_voice: null,
  tone: null,
  brand_values: [],
  key_messages: [],
  content_themes: [],
  ctas: [],
  keywords: [],
  visual_cues: null,
  language: null,
  dos: [],
  donts: [],
};

function fakeLlm(opts: { verifyFails?: boolean } = {}) {
  // Typed as mocks; cast with asLlm() where a provider is expected.
  return {
    extractResearchFacts: vi.fn(async (source: string, _excerpt: string, _opts?: unknown) => ({
      facts: [
        { category: "offering", fact: "Sells evil-eye bracelets", evidence: "evil eye bracelets" },
        { category: "offering", fact: "sells EVIL-EYE bracelets!", evidence: null }, // duplicate
        { category: "pricing", fact: `Price seen in ${source}`, evidence: "₹499" },
      ],
      voice_samples: ["Good vibes only 🧿"],
      customer_signals: source.includes("comments") ? ["People ask about the price"] : [],
    })),
    synthesizeBusinessDna: vi.fn(async (_dossier: string, _opts?: unknown) => ({ ...DNA, summary: "draft", gaps: ["No returns policy found"] })),
    verifyBusinessDna: vi.fn(async (_d: string, draft: BusinessDnaParsed, _opts?: unknown) => {
      if (opts.verifyFails) throw new Error("timeout");
      return { ...draft, summary: "checked" };
    }),
  };
}

const asLlm = (m: ReturnType<typeof fakeLlm>) => m as unknown as LLMProvider;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchInstagramProfile).mockResolvedValue({
    id: "ig1", username: "glowfinch_official", name: "Glowfinch", biography: "Protection & grace", website: "https://glowfinch.test",
    profilePictureUrl: null, followers: 1200, follows: 10, mediaCount: 40,
  });
  vi.mocked(fetchInstagramMedia).mockResolvedValue([
    { id: "m1", caption: "New drop RAWONLY-MARKER 🧿", mediaType: "IMAGE", imageUrl: null, permalink: null, timestamp: "2026-09-01T00:00:00Z", likes: 10, comments: 2 },
  ]);
  vi.mocked(fetchRecentComments).mockResolvedValue([
    { id: "c1", text: "Price?", author: "fan", timestamp: "2026-09-02T00:00:00Z", hidden: false, mediaId: "m1", permalink: null, caption: null },
    { id: "c2", text: "Thanks all!", author: "glowfinch_official", timestamp: "2026-09-02T00:00:00Z", hidden: false, mediaId: "m1", permalink: null, caption: null },
  ]);
  vi.mocked(crawlWebsite).mockResolvedValue({
    url: "https://glowfinch.test/",
    pages: [
      { url: "https://glowfinch.test/", title: "Glowfinch", description: null, headings: [], structuredData: null, text: "Evil eye bracelets, handmade. ".repeat(20) },
      { url: "https://glowfinch.test/pages/faq", title: "FAQ", description: null, headings: [], structuredData: null, text: "We ship in 3 days. ".repeat(20) },
    ],
  });
});

describe("runBusinessResearch", () => {
  it("researches every source, then writes only from the dossier and fact-checks it", async () => {
    const llm = fakeLlm();
    const events: string[] = [];
    const r = await runBusinessResearch({
      llm: asLlm(llm),
      instagram: { igUserId: "ig1", token: "t" },
      websiteUrl: null, // falls back to the bio link
      onProgress: (e) => void events.push(`${e.phase ?? ""}|${e.step}`),
    });

    expect(crawlWebsite).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/glowfinch\.test\/?$/), { deep: true });
    const sources = llm.extractResearchFacts.mock.calls.map((c) => c[0] as string);
    expect(sources).toEqual(["instagram profile & captions", "instagram comments", "website: /", "website: /pages/faq"]);
    // The brand's own comment isn't treated as customer input.
    expect(String(llm.extractResearchFacts.mock.calls[1]![1])).not.toContain("Thanks all!");

    // Synthesis sees the dossier (facts + evidence), never the raw captions.
    const dossier = String(llm.synthesizeBusinessDna.mock.calls[0]![0]);
    expect(dossier).toContain("Sells evil-eye bracelets");
    expect(dossier).toContain('"evil eye bracelets"');
    expect(dossier).not.toContain("RAWONLY-MARKER");
    expect(llm.verifyBusinessDna).toHaveBeenCalledWith(dossier, expect.objectContaining({ summary: "draft" }), expect.anything());

    expect(r.dna.summary).toBe("checked");
    expect(r.dossier.gaps).toEqual(["No returns policy found"]);
    expect(r.dossier.facts.filter((f) => f.fact.toLowerCase().includes("evil-eye bracelets"))).toHaveLength(1); // de-duplicated
    expect(r.dossier.stats).toMatchObject({ captions: 1, comments: 1, pages: 2, excerpts: 4 });
    expect(r.sources.website?.pages).toHaveLength(2);
    expect(events[0]).toBe("researching|Research started");
    expect(events.some((e) => e.startsWith("analyzing|Extracting facts"))).toBe(true);
  });

  it("keeps going when a source fails, and records the warning", async () => {
    vi.mocked(crawlWebsite).mockRejectedValue(new Error("site down"));
    const warnings: string[] = [];
    const r = await runBusinessResearch({
      llm: asLlm(fakeLlm()),
      instagram: { igUserId: "ig1", token: "t" },
      websiteUrl: "glowfinch.test",
      onProgress: (e) => void (e.level === "warn" && warnings.push(e.step)),
    });
    expect(warnings).toContain("Website couldn't be read");
    expect(r.sources.website).toMatchObject({ error: "site down" });
    expect(r.dossier.stats.pages).toBe(0);
  });

  it("uses the draft (from research) if the fact-check fails", async () => {
    const r = await runBusinessResearch({ llm: asLlm(fakeLlm({ verifyFails: true })), instagram: { igUserId: "ig1", token: "t" }, websiteUrl: null });
    expect(r.dna.summary).toBe("draft");
  });

  it("refuses to write anything when there's nothing to research", async () => {
    vi.mocked(crawlWebsite).mockRejectedValue(new Error("down"));
    const llm = fakeLlm();
    await expect(runBusinessResearch({ llm: asLlm(llm), instagram: null, websiteUrl: "x.test" })).rejects.toThrow(/Nothing to research/);
    expect(llm.synthesizeBusinessDna).not.toHaveBeenCalled();
  });
});

describe("research helpers", () => {
  it("chunkText splits on lines within the limit", () => {
    const chunks = chunkText(["a".repeat(60), "b".repeat(60), "c".repeat(60)].join("\n"), 130);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length <= 130)).toBe(true);
  });

  it("mergeFindings de-duplicates facts and samples across sources", () => {
    const m = mergeFindings([
      { source: "a", facts: [{ category: "usp", fact: "Handmade in Pune", evidence: null }], voice_samples: ["Hi!"], customer_signals: [] },
      { source: "b", facts: [{ category: "usp", fact: "handmade in pune.", evidence: "x" }], voice_samples: ["hi"], customer_signals: [] },
    ]);
    expect(m.facts).toEqual([{ category: "usp", fact: "Handmade in Pune", evidence: null, source: "a" }]);
    expect(m.voice_samples).toEqual(["Hi!"]);
  });
});

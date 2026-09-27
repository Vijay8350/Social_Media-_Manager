import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { businessDnaSchema } from "./schemas";
import { buildBusinessSourceText, businessToAccountDnaPatch } from "./business";
import { buildDnaSystemPrompt } from "./prompt";
import { encryptSecret } from "./crypto";
import { encryptLlmKey, readLlmSettings, resolveLlmConfig } from "./llm-settings";
import type { AccountDna, BusinessDna } from "./types";

const business = (over: Partial<BusinessDna> = {}): BusinessDna => ({
  id: "b1",
  account_id: "a1",
  user_id: "u1",
  business_name: "Acme Soap",
  website_url: "https://acme.test/",
  summary: "Small-batch soap.",
  industry: "handmade skincare",
  offerings: ["bar soap"],
  usps: ["zero palm oil"],
  target_customers: "eco-minded 25-40s",
  brand_voice: "warm, honest maker",
  tone: "calm",
  brand_values: [],
  key_messages: [],
  content_themes: ["ingredients", "behind the scenes"],
  ctas: ["Shop via link in bio"],
  keywords: ["handmadesoap", "zerowaste"],
  visual_cues: "earthy greens",
  language: "English",
  dos: ["show hands at work"],
  donts: ["medical claims"],
  use_in_generation: true,
  sources: {},
  generated_at: null,
  updated_at: "2026-01-01",
  ...over,
});

describe("businessDnaSchema", () => {
  it("normalizes loose model output", () => {
    const parsed = businessDnaSchema.parse({
      summary: "  A soap shop.  ",
      offerings: [{ name: "Bar soap", description: "cold process" }, "Gift box", "Gift box", ""],
      usps: "zero palm oil",
      tone: null,
      keywords: [42],
    });
    expect(parsed.summary).toBe("A soap shop.");
    expect(parsed.offerings).toEqual(["Bar soap — cold process", "Gift box"]);
    expect(parsed.usps).toEqual(["zero palm oil"]);
    expect(parsed.tone).toBeNull();
    expect(parsed.business_name).toBeNull();
    expect(parsed.dos).toEqual([]);
    expect(parsed.keywords).toEqual(["42"]);
  });

  it("requires a summary", () => {
    expect(() => businessDnaSchema.parse({ summary: "   " })).toThrow();
  });
});

describe("buildBusinessSourceText", () => {
  it("includes profile, starred top captions and website pages", () => {
    const text = buildBusinessSourceText({
      instagram: {
        username: "acme",
        name: "Acme",
        biography: "Soap, kindly.",
        website: "https://acme.test",
        followers: 1200,
        mediaCount: 3,
        posts: [
          { caption: "New lavender bar", likes: 10, comments: 1, timestamp: "2026-09-01T00:00:00Z" },
          { caption: null, likes: 99, comments: 9, timestamp: "2026-08-01T00:00:00Z" },
        ],
      },
      website: {
        url: "https://acme.test/",
        pages: [
          { url: "https://acme.test/", title: "Acme", description: null, headings: ["Hi"], structuredData: null, text: "We make soap." },
        ],
      },
    });
    expect(text).toContain("Username: @acme");
    expect(text).toContain("- ★ [2026-09-01 · 10 likes, 1 comments] New lavender bar");
    expect(text).not.toContain("99 likes"); // caption-less posts are skipped
    expect(text).toContain("## Website page: https://acme.test/");
    expect(text).toContain("We make soap.");
  });
});

describe("businessToAccountDnaPatch", () => {
  it("replaces voice fields, merges rules, and only fills empty strategy/style", () => {
    const existing = {
      dos: ["keep it short"],
      donts: ["medical claims"],
      hashtag_strategy: "3 broad + 3 niche",
      visual_identity: { mood: "soft" },
    } as unknown as AccountDna;
    const { patch, fields } = businessToAccountDnaPatch(business(), existing);
    expect(patch.persona).toBe("warm, honest maker");
    expect(patch.niche).toBe("handmade skincare — Acme Soap");
    expect(patch.content_pillars).toEqual(["ingredients", "behind the scenes"]);
    expect(patch.dos).toEqual(["keep it short", "show hands at work"]);
    expect(patch.donts).toEqual(["medical claims"]);
    expect(patch.hashtag_strategy).toBeUndefined();
    expect(patch.visual_identity).toEqual({ mood: "soft", style: "earthy greens" });
    expect(fields).toContain("persona");
    expect(fields).not.toContain("hashtag strategy");
  });

  it("leaves fields alone when the business has no value", () => {
    const { patch } = businessToAccountDnaPatch(
      business({ brand_voice: null, content_themes: [], dos: [] }),
      null,
    );
    expect(patch).not.toHaveProperty("persona");
    expect(patch).not.toHaveProperty("content_pillars");
    expect(patch).not.toHaveProperty("dos");
    expect(patch.hashtag_strategy).toMatch(/handmadesoap, zerowaste/);
  });
});

describe("buildDnaSystemPrompt with Business DNA", () => {
  it("is unchanged without a business", () => {
    const dna = { persona: "witty", visual_identity: {} } as unknown as AccountDna;
    expect(buildDnaSystemPrompt(dna)).toBe(buildDnaSystemPrompt(dna, null));
    expect(buildDnaSystemPrompt(dna)).not.toContain("Business context");
  });

  it("adds business context, and works with business alone", () => {
    const dna = { persona: "witty", visual_identity: {} } as unknown as AccountDna;
    expect(buildDnaSystemPrompt(dna, business())).toContain("- Offerings: bar soap");
    const solo = buildDnaSystemPrompt(null, business());
    expect(solo).toContain("specific business's Instagram account");
    expect(solo).toContain("- Language: write in English");
    expect(solo).toMatch(/Respond ONLY with valid JSON/);
  });
});

describe("resolveLlmConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers the user's key, model and base URL", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.DEEPSEEK_API_KEY = "server-key";
    const s = readLlmSettings({
      llm: { api_key_encrypted: encryptLlmKey("sk-user"), model: "deepseek-reasoner", base_url: "https://proxy.test" },
    });
    expect(resolveLlmConfig(s)).toEqual({
      apiKey: "sk-user",
      baseUrl: "https://proxy.test",
      model: "deepseek-reasoner",
      untrustedBaseUrl: true,
    });
  });

  it("refuses other ciphertexts pasted in as the key (e.g. an encrypted page token)", () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const s = readLlmSettings({
      llm: { api_key_encrypted: encryptSecret("EAAB-page-token"), base_url: "https://evil.test" },
    });
    expect(() => resolveLlmConfig(s)).toThrow(/can't be decrypted/);
  });

  it("uses the server key with the user's model, never a user base URL", () => {
    process.env.DEEPSEEK_API_KEY = "server-key";
    delete process.env.DEEPSEEK_BASE_URL;
    const cfg = resolveLlmConfig({ model: "deepseek-reasoner", base_url: "https://evil.test" });
    expect(cfg).toEqual({ apiKey: "server-key", baseUrl: "https://api.deepseek.com", model: "deepseek-reasoner" });
  });

  it("returns null with no key anywhere", () => {
    delete process.env.DEEPSEEK_API_KEY;
    expect(resolveLlmConfig({})).toBeNull();
  });

  it("ignores malformed settings", () => {
    expect(readLlmSettings(null)).toEqual({});
    expect(readLlmSettings({ llm: "nope" })).toEqual({});
    expect(readLlmSettings({ llm: { model: 5 } }).model).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { getLLMProvider, pickDeepSeekModel, testLLMConnection } from "./llm";

const cfg = { apiKey: "sk-test", baseUrl: "https://api.deepseek.test", model: "deepseek-chat" };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MODELS = { data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pickDeepSeekModel", () => {
  it("prefers the fast chat model, then anything the key has", () => {
    expect(pickDeepSeekModel(["deepseek-v4-pro", "deepseek-flash"])).toBe("deepseek-flash");
    expect(pickDeepSeekModel(["some-new-model"])).toBe("some-new-model");
    expect(pickDeepSeekModel([])).toBeNull();
  });
});

describe("testLLMConnection", () => {
  it("suggests a model the key has when the configured one is gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).endsWith("/models") ? json(200, MODELS) : json(404, {}))),
    );
    const r = await testLLMConnection(cfg);
    expect(r).toMatchObject({ ok: false, problem: "model", suggestedModel: "deepseek-flash" });
    expect(r.models).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });
});

describe("DeepSeek provider", () => {
  const idea = { theme: "t", angle: "a", format: "f", summary: "s" };
  const completion = { choices: [{ message: { content: JSON.stringify(idea) } }] };

  it("switches to an available model when the configured one doesn't exist", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const models: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/models")) return json(200, MODELS);
      const model = JSON.parse(String(init?.body)).model as string;
      models.push(model);
      return model === "deepseek-chat"
        ? json(400, { error: { message: "Model Not Exist", type: "invalid_request_error" } })
        : json(200, completion);
    });
    vi.stubGlobal("fetch", fetchMock);

    const llm = getLLMProvider(cfg);
    await expect(llm.generateIdea(null, "seed", [])).resolves.toEqual(idea);
    await llm.generateIdea(null, "seed", []); // remembers the switch
    expect(models).toEqual(["deepseek-chat", "deepseek-flash", "deepseek-flash"]);
  });

  it("reviewComments keeps only asked-for ids, never replies to bad ones, and sanitizes drafts", async () => {
    const results = [
      { id: "a", verdict: "positive", confidence: 0.9, reason: "praise", reply: "Thanks! Visit shop.example.com" },
      { id: "b", verdict: "BAD", category: "Self Promotion", confidence: "0.95", reason: "spam", reply: "Hi!" },
      { id: "c", verdict: "question", confidence: 0.8, reason: "asks", reply: "Great question #tips — DM us!" },
      { id: "injected", verdict: "positive", confidence: 1, reason: "x", reply: "Hello" },
      { id: "a", verdict: "bad", confidence: 1, reason: "dup", reply: null },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { choices: [{ message: { content: JSON.stringify({ results }) } }] })),
    );
    const out = await getLLMProvider(cfg).reviewComments(
      ["a", "b", "c"].map((id) => ({ id, author: "fan", text: "…", post: null })),
      null,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(out[0]).toMatchObject({ verdict: "positive", reply: null }); // link → dropped
    expect(out[1]).toMatchObject({ verdict: "bad", category: "self_promotion", confidence: 0.95, reply: null });
    expect(out[2]).toMatchObject({ verdict: "question", category: null, reply: "Great question — DM us!" });
  });

  it("does not switch on other 400s when the configured model exists", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      String(url).endsWith("/models")
        ? json(200, { data: [{ id: "deepseek-chat" }, { id: "deepseek-flash" }] })
        : json(400, { error: { message: "This model's maximum context length is 65536 tokens" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLLMProvider(cfg).generateIdea(null, "seed", [])).rejects.toThrow(/DeepSeek 400/);
    const bodies = fetchMock.mock.calls
      .map(([, init]) => (init as RequestInit | undefined)?.body)
      .filter(Boolean)
      .map((b) => JSON.parse(String(b)).model);
    expect(new Set(bodies)).toEqual(new Set(["deepseek-chat"]));
  });
});

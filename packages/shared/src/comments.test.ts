import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCommentCycle, sendCommentReply } from "./comments";
import { fetchRecentComments, replyToComment, setCommentHidden, type MediaComment } from "./providers/instagram";
import type { LLMProvider } from "./providers/llm";
import { sanitizeCommentReply, type CommentReviewParsed } from "./schemas";

vi.mock("./providers/instagram", () => ({
  fetchRecentComments: vi.fn(),
  replyToComment: vi.fn(async () => "reply-1"),
  setCommentHidden: vi.fn(async () => {}),
}));

// --- a tiny in-memory stand-in for the Supabase query builder --------------
type Row = Record<string, unknown>;
type Res = { data: unknown; error: null; count?: number };
class Query implements PromiseLike<Res> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "update" | "upsert" = "select";
  private patch: Row = {};
  private rows: Row[] = [];
  private conflict: string[] = [];
  private head = false;
  private single = false;
  private returning = false;
  private lim?: number;
  private sort?: { col: string; asc: boolean };
  constructor(private db: Record<string, Row[]>, private table: string) {}
  select(_cols?: string, opts?: { head?: boolean }) {
    if (this.op === "select") this.head = Boolean(opts?.head);
    else this.returning = true;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  upsert(rows: Row[], opts: { onConflict: string }) {
    this.op = "upsert";
    this.rows = rows;
    this.conflict = opts.onConflict.split(",");
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => String(r[c] ?? "") >= v);
    return this;
  }
  order(col: string, o: { ascending: boolean }) {
    this.sort = { col, asc: o.ascending };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  then<A = Res, B = never>(
    ok?: ((v: Res) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.run()).then(ok, fail);
  }
  private run(): Res {
    const table = (this.db[this.table] ??= []);
    if (this.op === "upsert") {
      for (const r of this.rows) {
        if (!table.some((t) => this.conflict.every((k) => t[k] === r[k]))) {
          table.push({ id: randomUUID(), status: "new", verdict: null, error: null, ...r });
        }
      }
      return { data: null, error: null };
    }
    let rows = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      rows.forEach((r) => Object.assign(r, this.patch));
      return { data: this.returning ? (this.single ? (rows[0] ?? null) : rows) : null, error: null };
    }
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.lim) rows = rows.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count: rows.length };
    return { data: this.single ? (rows[0] ?? null) : rows, error: null, count: rows.length };
  }
}
const fakeClient = (db: Record<string, Row[]>) =>
  ({ from: (t: string) => new Query(db, t) }) as unknown as SupabaseClient;
// ---------------------------------------------------------------------------

const USER = "user-1";
const ACCOUNT = { id: "acct-1", ig_user_id: "ig-1", ig_username: "brand" };
const now = new Date().toISOString();
const comment = (id: string, text: string, author = "fan"): MediaComment => ({
  id,
  text,
  author,
  timestamp: now,
  hidden: false,
  mediaId: "m1",
  permalink: "https://instagram.com/p/x",
  caption: "Monday motivation",
});

function llmReturning(reviews: (text: string) => Omit<CommentReviewParsed, "id">) {
  return {
    reviewComments: vi.fn(async (cs: { id: string; text: string }[]) => cs.map((c) => ({ id: c.id, ...reviews(c.text) }))),
  } as unknown as LLMProvider;
}

const review = (verdict: CommentReviewParsed["verdict"], confidence: number, reply: string | null) => ({
  verdict,
  category: verdict === "bad" ? ("spam" as const) : null,
  reason: "test",
  confidence,
  reply,
});

describe("runCommentCycle", () => {
  let db: Record<string, Row[]>;
  beforeEach(() => {
    vi.clearAllMocks();
    db = { ig_comments: [], comment_settings: [{ account_id: ACCOUNT.id, user_id: USER }] };
  });

  const run = (reply_mode: "off" | "review" | "auto", llm: LLMProvider, extra: { limit?: number; autoHide?: boolean } = {}) =>
    runCommentCycle({
      client: fakeClient(db),
      userId: USER,
      account: ACCOUNT,
      token: "tok",
      settings: { reply_mode, auto_hide: extra.autoHide ?? true, daily_reply_limit: extra.limit ?? 30 },
      llm,
      dna: null,
      business: null,
    });

  it("flags bad comments, hiding only confident ones, and never replies to them", async () => {
    vi.mocked(fetchRecentComments).mockResolvedValue([comment("c1", "DM me to earn $$$"), comment("c2", "meh spam?")]);
    const llm = llmReturning((t) => review("bad", t.startsWith("DM") ? 0.95 : 0.6, null));
    const r = await run("auto", llm);
    expect(r).toMatchObject({ reviewed: 2, flagged: 2, hidden: 1, replied: 0 });
    expect(setCommentHidden).toHaveBeenCalledTimes(1);
    expect(replyToComment).not.toHaveBeenCalled();
    expect(db.ig_comments!.map((c) => [c.status, c.hidden])).toEqual([["flagged", true], ["flagged", false]]);
  });

  it("drafts replies in review mode without sending", async () => {
    vi.mocked(fetchRecentComments).mockResolvedValue([comment("c1", "Love this ❤️")]);
    const r = await run("review", llmReturning(() => review("positive", 0.9, "Thank you so much!")));
    expect(r).toMatchObject({ drafted: 1, replied: 0 });
    expect(db.ig_comments![0]).toMatchObject({ status: "draft", reply_text: "Thank you so much!" });
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("auto-replies within the daily limit, drafts the rest, and skips its own comments", async () => {
    vi.mocked(fetchRecentComments).mockResolvedValue([
      comment("c1", "Great post"),
      comment("c2", "So true"),
      comment("c3", "Thanks all!", "brand"),
    ]);
    const r = await run("auto", llmReturning(() => review("positive", 0.9, "Glad it resonated!")), { limit: 1 });
    expect(r).toMatchObject({ fetched: 2, replied: 1, drafted: 1 });
    expect(replyToComment).toHaveBeenCalledTimes(1);
    expect(db.ig_comments!.map((c) => c.status).sort()).toEqual(["draft", "replied"]);
  });

  it("doesn't auto-send when the model is unsure", async () => {
    vi.mocked(fetchRecentComments).mockResolvedValue([comment("c1", "hmm")]);
    await run("auto", llmReturning(() => review("neutral", 0.4, "Tell us more?")));
    expect(replyToComment).not.toHaveBeenCalled();
    expect(db.ig_comments![0]!.status).toBe("draft");
  });

  it("is idempotent: a second run never re-reviews or re-replies", async () => {
    vi.mocked(fetchRecentComments).mockResolvedValue([comment("c1", "Great post")]);
    const llm = llmReturning(() => review("positive", 0.9, "Thanks!"));
    await run("auto", llm);
    const again = await run("auto", llm);
    expect(again).toMatchObject({ reviewed: 0, replied: 0 });
    expect(replyToComment).toHaveBeenCalledTimes(1);
    expect(db.ig_comments).toHaveLength(1);
  });

  it("records an Instagram error instead of throwing", async () => {
    vi.mocked(fetchRecentComments).mockRejectedValue(new Error("(#10) Requires instagram_manage_comments"));
    const r = await run("review", llmReturning(() => review("positive", 0.9, null)));
    expect(r.error).toMatch(/instagram_manage_comments/);
    expect(db.comment_settings![0]!.last_error).toMatch(/instagram_manage_comments/);
  });
});

describe("sendCommentReply", () => {
  it("sends exactly once even when two sends race", async () => {
    vi.clearAllMocks();
    const db: Record<string, Row[]> = {
      ig_comments: [{ id: "row-1", ig_comment_id: "c1", user_id: USER, status: "draft" }],
    };
    const client = fakeClient(db);
    const row = { id: "row-1", ig_comment_id: "c1" };
    const [a, b] = await Promise.all([
      sendCommentReply(client, USER, row, "tok", "Thanks!"),
      sendCommentReply(client, USER, row, "tok", "Thanks!"),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(replyToComment).toHaveBeenCalledTimes(1);
    expect(db.ig_comments![0]).toMatchObject({ status: "replied", reply_ig_id: "reply-1" });
  });
});

describe("sanitizeCommentReply", () => {
  it("drops replies with links, emails or phone numbers", () => {
    expect(sanitizeCommentReply("Shop now at example.com!")).toBeNull();
    expect(sanitizeCommentReply("See https://x.io")).toBeNull();
    expect(sanitizeCommentReply("Mail us at a@b.co")).toBeNull();
    expect(sanitizeCommentReply("Call +91 98765 43210")).toBeNull();
  });
  it("strips hashtags and mentions, keeps the message", () => {
    expect(sanitizeCommentReply("Thank you @fan! #blessed #love ❤️")).toBe("Thank you! ❤️");
    expect(sanitizeCommentReply("  So glad   it helped  ")).toBe("So glad it helped");
  });
  it("rejects empty and overlong replies", () => {
    expect(sanitizeCommentReply("#tag @user")).toBeNull();
    expect(sanitizeCommentReply("a".repeat(301))).toBeNull();
    expect(sanitizeCommentReply(null)).toBeNull();
  });
});

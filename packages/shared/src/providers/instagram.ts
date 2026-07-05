/**
 * Instagram Graph API — Content Publishing (official API only).
 * Flow: create a media container from a public image URL + caption, then publish
 * the container. Callers pass the IG user id + the (decrypted) Page access token.
 */

const GRAPH = "https://graph.facebook.com";

function version(): string {
  return process.env.FACEBOOK_GRAPH_VERSION || "v21.0";
}

async function graphPost<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "POST" });
  const body = (await res.json()) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok || (body as { error?: unknown }).error) {
    const err = (body as { error?: { message?: string; code?: number } }).error;
    const e = new Error(err?.message ?? `Graph publish failed (${res.status})`);
    (e as Error & { code?: number }).code = err?.code;
    throw e;
  }
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MediaInsights {
  likes: number | null;
  comments: number | null;
  reach: number | null;
  saves: number | null;
}

/** Fetch engagement metrics for a published media (M8 analytics). Best-effort. */
export async function fetchMediaInsights(
  mediaId: string,
  pageAccessToken: string,
): Promise<MediaInsights> {
  const v = version();
  const out: MediaInsights = { likes: null, comments: null, reach: null, saves: null };

  // Basic counts from the media node.
  try {
    const url = new URL(`${GRAPH}/${v}/${mediaId}`);
    url.searchParams.set("fields", "like_count,comments_count");
    url.searchParams.set("access_token", pageAccessToken);
    const res = await fetch(url.toString());
    if (res.ok) {
      const d = (await res.json()) as { like_count?: number; comments_count?: number };
      out.likes = d.like_count ?? null;
      out.comments = d.comments_count ?? null;
    }
  } catch {
    /* best-effort */
  }

  // Reach / saved from insights.
  try {
    const url = new URL(`${GRAPH}/${v}/${mediaId}/insights`);
    url.searchParams.set("metric", "reach,saved");
    url.searchParams.set("access_token", pageAccessToken);
    const res = await fetch(url.toString());
    if (res.ok) {
      const d = (await res.json()) as {
        data?: Array<{ name: string; values?: Array<{ value: number }> }>;
      };
      for (const m of d.data ?? []) {
        const val = m.values?.[0]?.value ?? null;
        if (m.name === "reach") out.reach = val;
        if (m.name === "saved") out.saves = val;
      }
    }
  } catch {
    /* best-effort */
  }

  return out;
}

export interface PublishResult {
  mediaId: string;
  creationId: string;
}

/**
 * Create a media container then publish it. Retries transient errors with
 * exponential backoff. `imageUrl` must be publicly fetchable by Instagram.
 */
export async function publishImagePost(params: {
  igUserId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
  maxRetries?: number;
}): Promise<PublishResult> {
  const { igUserId, pageAccessToken, imageUrl, caption } = params;
  const maxRetries = params.maxRetries ?? 3;
  const v = version();

  // 1) Create container.
  const createUrl = new URL(`${GRAPH}/${v}/${igUserId}/media`);
  createUrl.searchParams.set("image_url", imageUrl);
  createUrl.searchParams.set("caption", caption);
  createUrl.searchParams.set("access_token", pageAccessToken);

  let creationId = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await graphPost<{ id: string }>(createUrl.toString());
      creationId = r.id;
      break;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(2 ** attempt * 1000);
    }
  }

  // 2) Publish container.
  const publishUrl = new URL(`${GRAPH}/${v}/${igUserId}/media_publish`);
  publishUrl.searchParams.set("creation_id", creationId);
  publishUrl.searchParams.set("access_token", pageAccessToken);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await graphPost<{ id: string }>(publishUrl.toString());
      return { mediaId: r.id, creationId };
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(2 ** attempt * 1000);
    }
  }
  throw new Error("unreachable");
}

import {
  getInstagramConfig,
  FACEBOOK_SCOPES,
  type InstagramConfig,
} from "./instagram-config";

/**
 * Instagram Graph API client helpers (server-only).
 *
 * Flow: OAuth dialog -> code -> short-lived user token -> long-lived user token
 * -> list Pages with their linked Instagram Business account -> store the Page
 * access token (used for Content Publishing) encrypted, per IG account.
 *
 * Official Graph API only — no browser automation or private endpoints.
 */

const GRAPH = "https://graph.facebook.com";

function graphUrl(cfg: InstagramConfig, path: string): string {
  return `${GRAPH}/${cfg.version}/${path}`;
}

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || (body as { error?: unknown }).error) {
    const msg =
      (body as { error?: { message?: string } }).error?.message ??
      `Graph API request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

/** Build the Facebook OAuth dialog URL the user is redirected to. */
export function getOAuthDialogUrl(state: string): string {
  const cfg = getInstagramConfig();
  const url = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", FACEBOOK_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

/** Exchange an OAuth code for a short-lived user access token. */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const cfg = getInstagramConfig();
  const url = new URL(graphUrl(cfg, "oauth/access_token"));
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("code", code);
  const data = await graphGet<{ access_token: string }>(url.toString());
  return data.access_token;
}

export interface LongLivedToken {
  accessToken: string;
  /** Unix ms expiry, or null if the API did not return expires_in. */
  expiresAt: number | null;
}

/** Upgrade a short-lived user token to a long-lived one (~60 days). */
export async function getLongLivedToken(
  shortToken: string,
): Promise<LongLivedToken> {
  const cfg = getInstagramConfig();
  const url = new URL(graphUrl(cfg, "oauth/access_token"));
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  const data = await graphGet<{ access_token: string; expires_in?: number }>(
    url.toString(),
  );
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
  };
}

/** Refresh a long-lived user token before expiry (re-exchange). Used by the worker (M7). */
export async function refreshLongLivedToken(
  longToken: string,
): Promise<LongLivedToken> {
  return getLongLivedToken(longToken);
}

export interface PageWithInstagram {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagram: { id: string; username: string } | null;
}

/**
 * List the user's Pages, each with its linked Instagram Business account (if any).
 * Page access tokens derived from a long-lived user token are themselves long-lived.
 */
export async function getPagesWithInstagram(
  userToken: string,
): Promise<PageWithInstagram[]> {
  const cfg = getInstagramConfig();
  const url = new URL(graphUrl(cfg, "me/accounts"));
  url.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,username}",
  );
  url.searchParams.set("access_token", userToken);

  const data = await graphGet<{
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string; username: string };
    }>;
  }>(url.toString());

  return data.data.map((p) => ({
    pageId: p.id,
    pageName: p.name,
    pageAccessToken: p.access_token,
    instagram: p.instagram_business_account
      ? {
          id: p.instagram_business_account.id,
          username: p.instagram_business_account.username,
        }
      : null,
  }));
}

/**
 * Best-effort revoke of the app's permissions for a token. Page tokens cannot
 * fully revoke app-level grants (that needs the user token), so failures are
 * swallowed by callers; the authoritative action is deleting our stored token.
 */
export async function revokeToken(
  subjectId: string,
  accessToken: string,
): Promise<void> {
  const cfg = getInstagramConfig();
  const url = new URL(graphUrl(cfg, `${subjectId}/permissions`));
  url.searchParams.set("access_token", accessToken);
  await fetch(url.toString(), { method: "DELETE", cache: "no-store" });
}

/**
 * Facebook Login / Instagram Graph API configuration, read from env.
 * Server-only. Never expose the app secret to the client.
 */

const DEFAULT_FACEBOOK_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];

/**
 * OAuth scopes requested during Facebook Login. Overridable via the
 * FACEBOOK_SCOPES env var (comma-separated) — useful to temporarily drop a
 * permission that isn't enabled on the Meta app yet (e.g. instagram_content_publish
 * before the Instagram product is added), so the connection can be tested.
 */
export const FACEBOOK_SCOPES: string[] = process.env.FACEBOOK_SCOPES
  ? process.env.FACEBOOK_SCOPES.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_FACEBOOK_SCOPES;

export interface InstagramConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  version: string;
}

/** True when the Meta app credentials are present (so the UI can prompt to configure). */
export function isInstagramConfigured(): boolean {
  return Boolean(
    process.env.FACEBOOK_APP_ID &&
      process.env.FACEBOOK_APP_SECRET &&
      process.env.FACEBOOK_OAUTH_REDIRECT_URI,
  );
}

/** Returns the config or throws a readable error if any var is missing. */
export function getInstagramConfig(): InstagramConfig {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = process.env.FACEBOOK_OAUTH_REDIRECT_URI;
  const version = process.env.FACEBOOK_GRAPH_VERSION || "v21.0";
  if (!appId || !appSecret || !redirectUri) {
    throw new Error(
      "Instagram is not configured: set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_OAUTH_REDIRECT_URI.",
    );
  }
  return { appId, appSecret, redirectUri, version };
}

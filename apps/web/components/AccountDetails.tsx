import Link from "next/link";
import { decryptSecret, loadLlmSettings, type InstagramAccount } from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import {
  getInstagramProfile,
  getRecentMedia,
  type InstagramMedia,
  type InstagramProfile,
} from "@/lib/instagram";
import {
  checkDeepSeek,
  checkGemini,
  inspectToken,
  COMMENT_SCOPE,
  CORE_SCOPES,
  type Check,
  type TokenStatus,
} from "@/lib/api-status";
import { StatusDot } from "@/components/StatusDot";
import { LocalTime } from "@/components/LocalTime";
import { setDefaultAccount } from "@/app/dashboard/actions";

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString());
const reason = (r: unknown) => (r instanceof Error ? r.message : "request failed");

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string | null }) {
  return (
    <div className="py-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{label}</span>
        <span className="truncate text-right font-medium">{value}</span>
      </div>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function CheckRow({ label, check }: { label: string; check: Check }) {
  const text = check.state === "ok" ? "Connected" : check.state === "off" ? "Not configured" : "Error";
  return <Row label={label} value={<StatusDot state={check.state} label={text} />} sub={check.detail} />;
}

function expiryText(d: Date | null): React.ReactNode {
  if (!d) return "Never";
  const days = Math.ceil((d.getTime() - Date.now()) / 864e5);
  return (
    <>
      <LocalTime iso={d.toISOString()} mode="date" /> ({days > 0 ? `${days} days left` : "expired"})
    </>
  );
}

/**
 * Full details for one Instagram account: live profile + recent posts, account
 * and API connection status, and the default-account toggle. Used by the account
 * Overview tab and the Dashboard home (default account).
 */
export async function AccountDetails({
  account: acct,
  isDefault,
  userId,
}: {
  account: InstagramAccount;
  isDefault: boolean;
  userId: string;
}) {
  const supabase = await createClient();
  // null when monitoring is off (or migration 0005 isn't applied yet)
  const { data: commentSettings } = await supabase
    .from("comment_settings")
    .select("reply_mode, auto_hide")
    .eq("account_id", acct.id)
    .maybeSingle();

  // Live details + connection checks straight from the APIs (never cached per account).
  const systemChecks = Promise.all([
    loadLlmSettings(supabase, userId).then(
      (llm) => checkDeepSeek(llm),
      (err): Check => ({ state: "error", detail: reason(err) }),
    ),
    checkGemini(),
  ]);
  let profile: InstagramProfile | null = null;
  let media: InstagramMedia[] = [];
  let liveError: string | null = null;
  let token: TokenStatus | null = null;
  let tokenError: string | null = null;
  if (acct.ig_user_id && acct.encrypted_token) {
    try {
      const accessToken = decryptSecret(acct.encrypted_token);
      const [p, m, t] = await Promise.allSettled([
        getInstagramProfile(acct.ig_user_id, accessToken),
        getRecentMedia(acct.ig_user_id, accessToken),
        inspectToken(accessToken),
      ]);
      if (p.status === "fulfilled") profile = p.value;
      else liveError = reason(p.reason);
      if (m.status === "fulfilled") media = m.value;
      if (t.status === "fulfilled") token = t.value;
      else tokenError = reason(t.reason);
    } catch (err) {
      liveError = tokenError = err instanceof Error ? err.message : "could not read the stored token";
    }
  } else {
    liveError = tokenError = "No Instagram token stored for this account.";
  }
  const [deepseek, gemini] = await systemChecks;

  const username = profile?.username ?? acct.ig_username ?? acct.ig_user_id ?? "account";
  const loginCheck: Check = token
    ? token.valid
      ? { state: "ok", detail: "" }
      : { state: "error", detail: token.error ?? "Token is no longer valid — reconnect." }
    : { state: "error", detail: tokenError ?? "Could not verify the token." };
  const graphCheck: Check = profile
    ? { state: "ok", detail: "Profile and posts loading" }
    : { state: "error", detail: liveError ?? "Request failed" };
  const granted = new Set(token?.scopes ?? []);
  const canPublish = loginCheck.state === "ok" && granted.has("instagram_content_publish");
  const loginExpiry = token
    ? expiryText(token.expiresAt)
    : acct.token_expiry
      ? expiryText(new Date(acct.token_expiry))
      : "—";

  return (
    <div className="flex flex-col gap-4">
      {/* Profile */}
      <section className="card flex flex-col gap-4 p-5">
        <div className="flex items-start gap-4">
          {profile?.profilePictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.profilePictureUrl}
              alt={`@${username}`}
              className="h-20 w-20 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xl font-bold text-accent">
              {(username[0] ?? "@").toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold">{profile?.name ?? `@${username}`}</h2>
              {isDefault && (
                <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent">
                  ★ Default
                </span>
              )}
            </div>
            <a
              href={`https://instagram.com/${username}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground hover:underline"
            >
              @{username} ↗
            </a>
            {profile?.biography && (
              <p className="mt-2 whitespace-pre-line text-sm">{profile.biography}</p>
            )}
            {profile?.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-sm text-accent hover:underline"
              >
                {profile.website}
              </a>
            )}
          </div>
          {!isDefault && (
            <form action={setDefaultAccount.bind(null, acct.id)}>
              <button className="btn-secondary whitespace-nowrap text-[13px]">☆ Set as default</button>
            </form>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-border pt-4 text-center">
          {[
            { label: "Posts", value: profile?.mediaCount ?? null },
            { label: "Followers", value: profile?.followers ?? null },
            { label: "Following", value: profile?.follows ?? null },
          ].map((s) => (
            <div key={s.label}>
              <div className="font-display text-xl font-bold">{fmt(s.value)}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {(loginCheck.state === "error" || liveError) && (
        <div className="card border-red-500/40 p-4 text-sm text-red-600">
          {loginCheck.state === "error" || /access token|session/i.test(liveError ?? "")
            ? "Instagram's login for this account has expired or was revoked — reconnect it to load live details and keep posting."
            : `Couldn't load live details from Instagram: ${liveError}`}{" "}
          <a href="/api/instagram/connect" className="font-semibold underline">
            Reconnect
          </a>
        </div>
      )}

      {/* Connection status */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card flex flex-col px-5 py-3">
          <h3 className="py-1 text-[15px] font-bold">Account connection</h3>
          <div className="divide-y divide-border">
            <Row
              label="Account status"
              value={
                <StatusDot
                  state={acct.status === "connected" ? "ok" : "error"}
                  label={acct.status === "connected" ? "Connected" : acct.status.replace("_", " ")}
                />
              }
            />
            <Row
              label="Instagram login"
              value={
                <StatusDot
                  state={loginCheck.state}
                  label={loginCheck.state === "ok" ? "Valid" : "Invalid"}
                />
              }
              sub={loginCheck.detail}
            />
            <Row label="Login expires" value={loginExpiry} />
            {token?.dataAccessExpiresAt && (
              <Row label="Data access until" value={expiryText(token.dataAccessExpiresAt)} />
            )}
            <Row label="Instagram user ID" value={acct.ig_user_id ?? "—"} />
            <Row label="Facebook Page ID" value={acct.page_id ?? "—"} />
            <Row label="Connected on" value={<LocalTime iso={acct.created_at} mode="date" />} />
          </div>
          <div className="border-t border-border py-3">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Permissions granted</div>
            {token ? (
              <div className="flex flex-wrap gap-1.5">
                {[...CORE_SCOPES, COMMENT_SCOPE].map((s) => (
                  <span
                    key={s}
                    title={s === COMMENT_SCOPE ? "Needed for comment auto-reply & moderation" : undefined}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      granted.has(s)
                        ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : "bg-muted text-muted-foreground line-through"
                    }`}
                  >
                    {granted.has(s) ? "✓" : "✕"} {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Unknown — the token couldn&apos;t be checked.</p>
            )}
          </div>
        </div>

        <div className="card flex flex-col px-5 py-3">
          <h3 className="py-1 text-[15px] font-bold">API connection</h3>
          <div className="divide-y divide-border">
            <CheckRow label="Instagram Graph API" check={graphCheck} />
            <CheckRow label="DeepSeek · text" check={deepseek} />
            <CheckRow label="Gemini · images & QA" check={gemini} />
            <Row
              label="Publishing"
              value={
                <StatusDot state={canPublish ? "ok" : "error"} label={canPublish ? "Ready" : "Blocked"} />
              }
              sub={
                canPublish
                  ? null
                  : loginCheck.state !== "ok"
                    ? "Needs a valid Instagram login."
                    : "Missing the instagram_content_publish permission — add the Instagram product in the Meta app, then reconnect."
              }
            />
            <Row
              label="Comments"
              value={
                <Link href={`/dashboard/comments?account=${acct.id}`} className="hover:underline">
                  <StatusDot
                    state={!commentSettings ? "off" : granted.has(COMMENT_SCOPE) ? "ok" : "error"}
                    label={
                      commentSettings
                        ? `On · ${commentSettings.reply_mode === "off" ? "moderation only" : `${commentSettings.reply_mode} replies`}`
                        : "Off"
                    }
                  />
                </Link>
              }
              sub={
                granted.has(COMMENT_SCOPE)
                  ? null
                  : `Needs the ${COMMENT_SCOPE} permission — reconnect the account.`
              }
            />
          </div>
        </div>
      </section>

      {/* Recent posts */}
      <section className="flex flex-col gap-2.5">
        <h3 className="text-[15px] font-bold">Recent posts</h3>
        {media.length === 0 ? (
          <div className="card border-dashed p-6 text-center text-sm text-muted-foreground">
            {liveError ? "Unavailable." : "No posts on this account yet."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.map((m) => (
              <a
                key={m.id}
                href={m.permalink ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="card group overflow-hidden"
              >
                {m.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.imageUrl}
                    // Slice by code point: slicing UTF-16 units can split an emoji, and the
                    // lone surrogate hydrates differently from the server HTML (React #418).
                    alt={m.caption ? Array.from(m.caption).slice(0, 80).join("") : "Instagram post"}
                    className="aspect-square w-full object-cover transition group-hover:opacity-90"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-muted text-xs text-muted-foreground">
                    {m.mediaType}
                  </div>
                )}
                <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    ♥ {fmt(m.likes)} · 💬 {fmt(m.comments)}
                  </span>
                  <LocalTime iso={m.timestamp} mode="date" />
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

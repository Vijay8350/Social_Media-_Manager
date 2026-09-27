import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Server-side website reader for Business DNA, plus the public-host guard used
 * for any user-supplied URL the server fetches (websites, custom LLM base URLs).
 *
 * The server runs on EC2, so an unguarded fetch of a user URL could reach the
 * instance metadata service (169.254.169.254 / fd00:ec2::254), localhost apps or
 * Redis. Every hop — including redirects — is resolved and rejected unless all
 * of its addresses are public. (Residual risk: DNS rebinding between our lookup
 * and fetch's own lookup; acceptable here since responses are only summarized.)
 */

export class UnsafeUrlError extends Error {}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
  });
}

/** Expand an IPv6 address to its 8 16-bit groups, or null if malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const n = v4ToInt(tail);
    s = `${s.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embeddedV4 = `${g6 >>> 8}.${g6 & 0xff}.${g7 >>> 8}.${g7 & 0xff}`;
  const first80Zero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (first80Zero && g5 === 0xffff) return isPublicV4(embeddedV4); // IPv4-mapped
  if (first80Zero && g5 === 0) return false; // ::, ::1, IPv4-compatible
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicV4(embeddedV4); // NAT64
  }
  if (g0 === 0x2002) {
    return isPublicV4(`${g1 >>> 8}.${g1 & 0xff}.${g2 >>> 8}.${g2 & 0xff}`); // 6to4
  }
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local (incl. EC2 fd00:ec2::254)
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return false; // link/site-local
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false; // discard
  return true;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind === 6) return isPublicV6(ip);
  return false;
}

/**
 * Parse a URL and ensure it's http(s) (https only if asked), on a standard port,
 * without credentials, and resolving only to public addresses.
 */
export async function assertPublicUrl(
  raw: string,
  opts: { httpsOnly?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && (opts.httpsOnly || url.protocol !== "http:")) {
    throw new UnsafeUrlError(opts.httpsOnly ? "Only https:// URLs are allowed." : "Only http(s) URLs are allowed.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials aren't allowed.");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UnsafeUrlError("Only the standard web ports (80/443) are allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || /(^|\.)(localhost|local|internal)$/.test(host)) {
    throw new UnsafeUrlError(`${host || "That host"} isn't a public website.`);
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new UnsafeUrlError(`Couldn't find ${host} — check the address.`);
    }
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) {
    throw new UnsafeUrlError(`${host} points to a private or reserved network address.`);
  }
  return url;
}

/** Accept "example.com" or "www.example.com/about" as well as full URLs. */
export function normalizeWebsiteUrl(input: string): string {
  const s = input.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

export interface WebsitePage {
  url: string;
  title: string | null;
  description: string | null;
  headings: string[];
  /** schema.org JSON-LD (Organization/Product/…), minified and truncated. */
  structuredData: string | null;
  text: string;
}

export interface WebsiteSnapshot {
  /** Final homepage URL (after redirects). */
  url: string;
  pages: WebsitePage[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Everything below parses untrusted HTML, so every pattern must run in linear
// time. Lazy `<x>[\s\S]*?</x>` and `<[^>]*>` rescan to the end of the document
// for each unclosed tag — quadratic — and a hostile page (e.g. 1.5 MB of "<svg>")
// would freeze the web process for every tenant. Tags stop at the next "<".
const TAG_RE = /<[^<>]*>/g;

function inlineText(html: string): string {
  return decodeEntities(html.replace(TAG_RE, " ")).replace(/\s+/g, " ").trim();
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  // The lookbehind anchors names at the start of a run, so a long run that isn't
  // followed by "=" is tried once, not once per character.
  const re = /(?<![a-z0-9_:.-])([a-z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const m of tag.slice(0, 4000).matchAll(re)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/**
 * Visit each `<tag …>inner</tag>` block (tags: a regex alternation like "h1|h2")
 * in one forward pass. Blocks never overlap; an unclosed tag is skipped with its
 * content left in place, and is never searched for again.
 */
function scanBlocks(
  html: string,
  tags: string,
  onBlock: (openTag: string, inner: string, start: number, end: number) => void,
): void {
  const opener = new RegExp(`<(${tags})\\b`, "gi");
  const closers = new Map<string, RegExp>();
  const unclosed = new Set<string>();
  for (let m = opener.exec(html); m; m = opener.exec(html)) {
    const tag = m[1]!.toLowerCase();
    if (unclosed.has(tag)) continue;
    const gt = html.indexOf(">", opener.lastIndex);
    if (gt === -1) return; // no complete tag can follow
    let closer = closers.get(tag);
    if (!closer) closers.set(tag, (closer = new RegExp(`</${tag}\\s*>`, "gi")));
    closer.lastIndex = gt + 1;
    const c = closer.exec(html);
    if (!c) {
      unclosed.add(tag);
      continue;
    }
    const end = c.index + c[0].length;
    onBlock(html.slice(m.index, gt + 1), html.slice(gt + 1, c.index), m.index, end);
    opener.lastIndex = end;
  }
}

/** Remove whole `<tag>…</tag>` blocks for the given tags. */
function stripBlocks(html: string, tags: string): string {
  let out = "";
  let pos = 0;
  scanBlocks(html, tags, (_open, _inner, start, end) => {
    out += html.slice(pos, start) + " ";
    pos = end;
  });
  return out + html.slice(pos);
}

/** Remove `<!-- … -->` comments; an unclosed comment ends the scan. */
function stripComments(html: string): string {
  let out = "";
  let pos = 0;
  for (let start = html.indexOf("<!--"); start !== -1; start = html.indexOf("<!--", pos)) {
    const end = html.indexOf("-->", start + 4);
    if (end === -1) break;
    out += html.slice(pos, start) + " ";
    pos = end + 3;
  }
  return out + html.slice(pos);
}

const SKIP_LINK = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|mp4|mp3|css|js|xml|json)$/i;

/** Extract readable content + same-site links from a page. */
export function extractPage(
  html: string,
  pageUrl: string,
  maxChars = 6000,
): WebsitePage & { links: string[] } {
  let title: string | undefined;
  scanBlocks(html, "title", (_open, inner) => {
    title ??= inner;
  });

  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^<>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.name ?? a.property ?? "").toLowerCase();
    if (key && a.content) meta[key] ??= a.content;
  }

  const ldBlocks: string[] = [];
  scanBlocks(html, "script", (open, inner) => {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(open)) return;
    try {
      ldBlocks.push(JSON.stringify(JSON.parse(inner)));
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  const jsonLd = ldBlocks.join(" ");

  const body = stripBlocks(stripComments(html), "script|style|noscript|svg|template|iframe|head");

  const headingSet = new Set<string>();
  scanBlocks(body, "h1|h2|h3", (_open, inner) => {
    const h = inlineText(inner).slice(0, 150);
    if (h) headingSet.add(h);
  });
  const headings = [...headingSet].slice(0, 25);

  const text = decodeEntities(
    body
      .replace(/<\/(p|div|li|h[1-6]|section|article|tr|header|footer)>|<br\s*\/?>/gi, "\n")
      .replace(TAG_RE, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ ?\n[\s]*/g, "\n")
    .trim()
    .slice(0, maxChars);

  const base = new URL(pageUrl);
  const site = base.hostname.replace(/^www\./, "");
  const links = new Set<string>();
  for (const m of body.matchAll(/<a\b[^<>]*>/gi)) {
    const href = attrs(m[0]).href;
    if (!href) continue;
    try {
      const u = new URL(href, base);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== site) continue;
      if (SKIP_LINK.test(u.pathname)) continue;
      u.hash = "";
      links.add(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  }

  return {
    url: pageUrl,
    title: title ? inlineText(title).slice(0, 200) || null : null,
    description: (meta["description"] ?? meta["og:description"] ?? "").slice(0, 400) || null,
    headings,
    structuredData: jsonLd ? jsonLd.slice(0, 2000) : null,
    text,
    links: [...links],
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 4;
const MAX_BYTES = 1_500_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; InstaPostGeneratorBot/1.0; business profile reader)";

async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - total;
    total += value.byteLength;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    if (total >= max) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

function describeNetworkError(cause: { code?: string; message?: string }): string {
  const code = cause.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "the domain doesn't resolve";
  if (code === "ECONNREFUSED") return "the server refused the connection";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "the connection was dropped";
  if (/CERT|SELF_SIGNED|TLS/.test(code)) return "its HTTPS certificate isn't valid for this address";
  return cause.message || code || "network error";
}

/** GET an HTML page, re-validating every redirect hop against the public-host guard. */
async function fetchHtml(start: string, timeoutMs: number): Promise<{ url: string; html: string }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) throw new Error(`${url.hostname} redirected without a location`);
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`${url.hostname} responded ${res.status}`);
      }
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(type)) {
        await res.body?.cancel();
        throw new Error(`${url.toString()} isn't an HTML page`);
      }
      return { url: url.toString(), html: await readCapped(res, MAX_BYTES) };
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`Timed out loading ${url.hostname}`);
      // fetch() only says "fetch failed"; the useful part is the network cause.
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      if (cause) throw new Error(`Couldn't load ${url.hostname}: ${describeNetworkError(cause)}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

/** Sub-pages worth reading for a business profile, in priority order. */
const PRIORITY_PATHS = [
  /about|our-?story|who-?we-?are|company/i,
  /products?|shop|collections?|catalog|store|menu/i,
  /services?|solutions?|pricing|plans/i,
];

/** Read the homepage plus up to (maxPages - 1) high-signal internal pages. */
export async function crawlWebsite(
  input: string,
  opts: { maxPages?: number; timeoutMs?: number } = {},
): Promise<WebsiteSnapshot> {
  const maxPages = opts.maxPages ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const home = await fetchHtml(normalizeWebsiteUrl(input), timeoutMs);
  const first = extractPage(home.html, home.url, 6000);

  const picks: string[] = [];
  for (const re of PRIORITY_PATHS) {
    if (picks.length >= maxPages - 1) break;
    const hit = first.links.find(
      (l) => l !== home.url && !picks.includes(l) && re.test(new URL(l).pathname),
    );
    if (hit) picks.push(hit);
  }

  const extra = await Promise.allSettled(
    picks.map(async (u) => {
      const r = await fetchHtml(u, timeoutMs);
      return extractPage(r.html, r.url, 3000);
    }),
  );

  const pages = [first, ...extra.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
  return { url: home.url, pages: pages.map(({ links: _links, ...page }) => page) };
}

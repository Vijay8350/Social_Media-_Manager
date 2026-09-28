import { describe, expect, it } from "vitest";
import { assertPublicUrl, extractPage, isPublicAddress, isUtilityPage, normalizeWebsiteUrl } from "./website";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // EC2 metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "fd00:ec2::254", // EC2 metadata (IPv6)
    "fc00::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2001:db8::1",
    "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
    "2002:7f00:1::", // 6to4 of 127.0.0.1
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );
});

describe("assertPublicUrl", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3200/",
    "http://[::1]/",
    "http://0x7f000001/", // WHATWG normalizes to 127.0.0.1
    "http://2130706433/",
    "http://localhost/",
    "http://app.localhost/",
    "file:///etc/passwd",
    "ftp://8.8.8.8/",
    "http://user:pass@8.8.8.8/",
    "http://8.8.8.8:6379/",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });

  it("requires https when asked", async () => {
    await expect(assertPublicUrl("http://8.8.8.8/", { httpsOnly: true })).rejects.toThrow(/https/);
    await expect(assertPublicUrl("https://8.8.8.8/", { httpsOnly: true })).resolves.toBeInstanceOf(URL);
  });
});

describe("normalizeWebsiteUrl", () => {
  it("adds https:// when missing", () => {
    expect(normalizeWebsiteUrl(" example.com/about ")).toBe("https://example.com/about");
    expect(normalizeWebsiteUrl("http://example.com")).toBe("http://example.com");
  });
});

describe("extractPage", () => {
  const html = `<!doctype html><html><head>
    <title>Acme &amp; Co — Handmade Soap</title>
    <meta content="Small-batch soap from Pune." name="description">
    <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
    <style>.x{color:red}</style>
  </head><body>
    <nav><a href="/about-us">About</a> <a href="https://www.acme.test/shop#top">Shop</a>
      <a href="https://other.test/x">Elsewhere</a> <a href="/logo.png">Logo</a> <a href="mailto:a@b.c">Mail</a></nav>
    <h1>Soap that&#39;s kind</h1><p>Cold-process, <b>zero</b> palm oil.</p>
    <script>alert("ignore me")</script><!-- hidden comment -->
  </body></html>`;

  it("pulls title, meta, headings, JSON-LD and readable text", () => {
    const page = extractPage(html, "https://acme.test/");
    expect(page.title).toBe("Acme & Co — Handmade Soap");
    expect(page.description).toBe("Small-batch soap from Pune.");
    expect(page.headings).toEqual(["Soap that's kind"]);
    expect(page.structuredData).toBe('{"@type":"Organization","name":"Acme"}');
    expect(page.text).toContain("Cold-process, zero palm oil.");
    expect(page.text).not.toMatch(/alert|hidden comment|color:red/);
  });

  it("keeps only same-site page links, without fragments", () => {
    const page = extractPage(html, "https://acme.test/");
    expect(page.links.sort()).toEqual(["https://acme.test/about-us", "https://www.acme.test/shop"]);
  });

  it("truncates text to maxChars", () => {
    expect(extractPage(`<p>${"a".repeat(500)}</p>`, "https://acme.test/", 100).text).toHaveLength(100);
  });

  it("does not match </header> as the end of <head>", () => {
    const page = extractPage(
      "<head><title>T</title></head><body><header>Top</header><p>Body text</p></body>",
      "https://acme.test/",
    );
    expect(page.text).toContain("Top");
    expect(page.text).toContain("Body text");
  });

  it("isUtilityPage flags cart/login/checkout-style pages only", () => {
    for (const u of ["/cart", "/checkout/x", "/account", "/authentication/login", "/search?q=x", "/pages/sign-in"]) {
      expect(isUtilityPage(`https://shop.test${u}`)).toBe(true);
    }
    for (const u of ["/", "/pages/about-us", "/collections/earrings", "/pages/faq", "/cartier-collection", "/policies/shipping-policy"]) {
      expect(isUtilityPage(`https://shop.test${u}`)).toBe(false);
    }
  });

  it("keeps content after an unclosed skipped tag", () => {
    const page = extractPage("<head><title>T</title><p>Still here</p>", "https://acme.test/");
    expect(page.text).toContain("Still here");
  });

  // A hostile site can serve unclosed tags; lazy [\s\S]*? regexes go quadratic on
  // that and would freeze the web process for every tenant.
  it.each(["<svg>", "<title>", "<h1>", "<!--", "<meta a=", "<a ", "<", "<script>", "<meta " + "x".repeat(5000) + ">", "&" + "a".repeat(50)])(
    "stays linear on 200 KB of %s",
    (unit) => {
      const html = unit.repeat(Math.ceil(200_000 / unit.length));
      const t0 = performance.now();
      extractPage(html, "https://acme.test/");
      expect(performance.now() - t0).toBeLessThan(500);
    },
  );
});

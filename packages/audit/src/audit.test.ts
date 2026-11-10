import { describe, expect, it } from "vitest";
import type { CrawledPage, CrawlResult } from "./crawl";
import { extractPage, parseSitemap } from "./html";
import { checkUrl, isPublicAddress } from "./net";
import { isAllowedByRobots, parseRobots } from "./robots";
import { auditHealth, auditScore, AUDIT_RULES, evaluateCrawl } from "./rules";
import { inScope, isExcludedCrawlPath, normalizeCrawlUrl } from "./urls";

describe("address safety", () => {
  it("refuses private, loopback, link-local and reserved IPv4", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "100.128.0.1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("refuses private IPv6, and IPv4 hidden inside IPv6", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1", "2001:db8::1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });
  it("allows loopback only when asked, and never private ranges", () => {
    expect(isPublicAddress("127.0.0.1", { allowLoopback: true })).toBe(true);
    expect(isPublicAddress("::1", { allowLoopback: true })).toBe(true);
    expect(isPublicAddress("10.0.0.1", { allowLoopback: true })).toBe(false);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
  it("vets URLs before connecting", () => {
    const policy = { allowedHosts: new Set(["example.com", "localhost:4000"]) };
    expect(checkUrl("https://example.com/a", policy)).toBe("ok");
    expect(checkUrl("https://other.com/", policy)).toBe("offsite");
    expect(checkUrl("https://example.com:8443/", policy)).toBe("bad_port");
    expect(checkUrl("http://localhost:4000/", policy)).toBe("ok");
    expect(checkUrl("gopher://example.com/", policy)).toBe("bad_protocol");
    expect(checkUrl("https://a:b@example.com/", policy)).toBe("credentials");
    expect(checkUrl("http://[::1]/", { allowedHosts: new Set(["[::1]"]) })).toBe("blocked_address");
  });
});

describe("robots.txt", () => {
  const robots = parseRobots(`
    User-agent: *
    Disallow: /private/
    Allow: /private/public-page
    Disallow: /*.pdf$
    Sitemap: https://example.com/sitemap.xml

    User-agent: ScopeKitBot
    Disallow: /only-for-us/
  `);
  it("uses the longest matching rule, and Allow on a tie", () => {
    const general = parseRobots("User-agent: *\nDisallow: /private/\nAllow: /private/public-page\nDisallow: /*.pdf$\nDisallow: /a\nAllow: /a");
    expect(isAllowedByRobots(general, "/private/x")).toBe(false);
    expect(isAllowedByRobots(general, "/private/public-page")).toBe(true);
    expect(isAllowedByRobots(general, "/file.pdf")).toBe(false);
    expect(isAllowedByRobots(general, "/file.pdf?x=1")).toBe(true);
    expect(isAllowedByRobots(general, "/a")).toBe(true);
    expect(isAllowedByRobots(general, "/open")).toBe(true);
  });
  it("lets a group for our own agent replace the wildcard group", () => {
    expect(isAllowedByRobots(robots, "/only-for-us/x")).toBe(false);
    expect(isAllowedByRobots(robots, "/private/x")).toBe(true);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });
  it("treats an empty Disallow and an empty file as allow-all", () => {
    expect(isAllowedByRobots(parseRobots("User-agent: *\nDisallow:"), "/x")).toBe(true);
    expect(isAllowedByRobots(parseRobots(""), "/x")).toBe(true);
  });
});

describe("HTML extraction", () => {
  const html = `<!doctype html><html lang="en"><head><title> A  title </title><meta name="description" content="Desc">
    <meta name="robots" content="NOINDEX, follow"><link rel="canonical" href="/canonical"><link rel="alternate" hreflang="xx_bad" href="/de">
    <script type="application/ld+json">{"a":1}</script><script type="application/ld+json">{bad}</script><style>.x{}</style></head>
    <body><h1>One</h1><h1>Two</h1><a href="/a#frag">a</a><a href="mailto:x@y.z">m</a><a rel="nofollow" href="https://other.test/">o</a>
    <img src="http://insecure.test/a.png"><img src="/b.png" alt=""><svg><title>icon</title></svg><p>five words are right here</p><script>var hidden = "not counted words";</script></body></html>`;
  const facts = extractPage(html, "https://example.com/page");
  it("reads titles, description, robots, canonical and headings", () => {
    expect(facts.titles).toEqual(["A title"]);
    expect(facts.metaDescriptions).toEqual(["Desc"]);
    expect(facts.robotsMeta).toBe("noindex, follow");
    expect(facts.canonicals).toEqual(["https://example.com/canonical"]);
    expect(facts.h1s).toEqual(["One", "Two"]);
    expect(facts.lang).toBe("en");
    expect(facts.hasViewport).toBe(false);
  });
  it("resolves links and skips non-page schemes", () => {
    expect(facts.links.map((l) => l.href)).toEqual(["https://example.com/a#frag", "https://other.test/"]);
    expect(facts.links[1]!.nofollow).toBe(true);
  });
  it("flags a missing alt but accepts an empty one, and finds insecure resources", () => {
    expect(facts.imagesMissingAlt.count).toBe(1);
    expect(facts.insecureResources).toEqual(["http://insecure.test/a.png"]);
  });
  it("validates JSON-LD and collects hreflang", () => {
    expect(facts.jsonLdErrors).toHaveLength(1);
    expect(facts.hreflang).toEqual([{ lang: "xx_bad", href: "/de" }]);
  });
  it("counts visible words only", () => {
    // One, Two, a, m, o, and the five words of the paragraph. Script, style, title and SVG text are left out.
    expect(facts.wordCount).toBe(10);
  });
  it("never executes or keeps markup from the page", () => {
    const hostile = extractPage(`<title><script>alert(1)</script></title><h1><img src=x onerror=alert(1)>Hi</h1>`, "https://example.com/");
    expect(hostile.h1s).toEqual(["Hi"]);
  });
});

describe("sitemaps and URLs", () => {
  it("reads url sets and indexes, and rejects other documents", () => {
    expect(parseSitemap(`<urlset><url><loc> https://example.com/a </loc></url><url><loc>https://example.com/b</loc><image:image><image:loc>https://example.com/i.png</image:loc></image:image></url></urlset>`)).toEqual({ type: "urlset", locs: ["https://example.com/a", "https://example.com/b"] });
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`).type).toBe("index");
    expect(parseSitemap("<html><body>404</body></html>").type).toBe("invalid");
  });
  it("normalizes to one spelling per page", () => {
    expect(normalizeCrawlUrl("HTTPS://Example.com:443/Path/?utm_source=x&page=2#top", ["page"])).toBe("https://example.com/Path/?page=2");
    expect(normalizeCrawlUrl("/b?b=2&a=1", ["a", "b"], "https://example.com/x")).toBe("https://example.com/b?a=1&b=2");
    expect(normalizeCrawlUrl("javascript:void(0)")).toBeNull();
    expect(normalizeCrawlUrl("https://u:p@example.com/")).toBeNull();
  });
  it("keeps the crawl inside the site and its exclusions", () => {
    const hosts = new Set(["example.com", "localhost:4000"]);
    expect(inScope("https://example.com/a", hosts)).toBe(true);
    expect(inScope("https://example.com:8080/a", hosts)).toBe(false);
    expect(inScope("https://sub.example.com/a", hosts)).toBe(false);
    expect(isExcludedCrawlPath("/admin/users", ["/admin"])).toBe(true);
    expect(isExcludedCrawlPath("/administrator", ["/admin"])).toBe(false);
    expect(isExcludedCrawlPath("/tmp-1", ["/tmp*"])).toBe(true);
  });
});

describe("rules and score", () => {
  const page = (url: string, over: Partial<CrawledPage> = {}, facts: Partial<NonNullable<CrawledPage["facts"]>> = {}): CrawledPage => ({
    url,
    depth: 1,
    status: 200,
    fetchError: null,
    redirectChain: [],
    redirectLoop: false,
    finalUrl: null,
    offsiteRedirect: false,
    contentType: "text/html",
    responseMs: 100,
    robotsBlocked: false,
    inSitemap: false,
    isHtml: true,
    xRobotsTag: null,
    htmlHash: "x",
    truncated: false,
    inlinks: 1,
    outlinks: 0,
    facts: { titles: [`Title of ${url}`], metaDescriptions: [`About ${url}`], robotsMeta: null, canonicals: [url], h1s: ["H"], hasViewport: true, links: [], imagesMissingAlt: { count: 0, samples: [] }, jsonLdErrors: [], hreflang: [], insecureResources: [], wordCount: 300, lang: "en", ...facts },
    ...over,
  });
  const result = (pages: CrawledPage[], over: Partial<CrawlResult> = {}): CrawlResult => ({ pages, links: [], sitemaps: [], robots: { found: true, status: 200 }, homepage: "https://example.com/", discovered: pages.length, crawled: pages.length, complete: true, stopReason: null, error: null, ...over });
  const run = (r: CrawlResult) => evaluateCrawl(r, { hostnames: ["example.com"] }).map((f) => `${f.ruleId} ${new URL(f.url).pathname}`);

  it("has the whole catalog, each rule fully described", () => {
    expect(AUDIT_RULES).toHaveLength(28);
    expect(new Set(AUDIT_RULES.map((r) => r.id)).size).toBe(28);
    for (const rule of AUDIT_RULES) for (const field of [rule.why, rule.impact, rule.detection, rule.falsePositives, rule.fix]) expect(field.length, rule.id).toBeGreaterThan(10);
  });
  it("finds nothing on a clean page", () => {
    expect(run(result([page("https://example.com/")]))).toEqual([]);
  });
  it("does not ask a noindex page for a title or description", () => {
    const found = run(result([page("https://example.com/x", {}, { titles: [], metaDescriptions: [], robotsMeta: "noindex" })]));
    expect(found).toEqual(["NOINDEX /x"]);
  });
  it("only reports orphans from a complete crawl", () => {
    const pages = [page("https://example.com/"), page("https://example.com/o", { inSitemap: true, inlinks: 0 })];
    expect(run(result(pages))).toContain("INTERNAL_ORPHAN /o");
    expect(run(result(pages, { complete: false }))).not.toContain("INTERNAL_ORPHAN /o");
  });
  it("detects canonical contradictions", () => {
    const pages = [page("https://example.com/a", {}, { canonicals: ["https://example.com/b"] }), page("https://example.com/b", {}, { canonicals: ["https://example.com/c"] }), page("https://example.com/c")];
    expect(run(result(pages))).toContain("CANONICAL_CONFLICT /a");
    expect(run(result([page("https://example.com/d", {}, { canonicals: ["https://example.com/d", "https://example.com/e"] })]))).toContain("CANONICAL_CONFLICT /d");
    expect(run(result([page("https://example.com/f", {}, { canonicals: ["https://elsewhere.test/f"] })]))).toContain("CANONICAL_OFFSITE /f");
  });
  it("scores by severity and share of pages, within 0 to 100", () => {
    expect(auditScore([], 50)).toBe(100);
    expect(auditScore([{ severity: "critical", affected: 1 }], 100)).toBe(97);
    expect(auditScore([{ severity: "critical", affected: 100 }], 100)).toBe(70);
    expect(auditScore([{ severity: "info", affected: 100 }], 100)).toBe(100);
    expect(auditScore(Array.from({ length: 10 }, () => ({ severity: "critical" as const, affected: 100 })), 100)).toBe(0);
    // One broken page still counts on a very large site.
    expect(auditScore([{ severity: "critical", affected: 1 }], 10_000)).toBe(97);
  });
  it("never calls a partial crawl healthy", () => {
    const none = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    expect(auditHealth({ complete: false, open: none, score: null })).toBe("insufficient_coverage");
    expect(auditHealth({ complete: false, open: { ...none, critical: 1 }, score: null })).toBe("critical");
    expect(auditHealth({ complete: true, open: none, score: 100 })).toBe("healthy");
    expect(auditHealth({ complete: true, open: { ...none, high: 2 }, score: 95 })).toBe("needs_attention");
  });
});

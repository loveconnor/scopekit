import type { Severity } from "@scopekit/contracts";
import type { CrawledPage, CrawlResult } from "./crawl";
import { inScope, normalizeCrawlUrl } from "./urls";

export type AuditRule = {
  id: string;
  version: number;
  severity: Severity;
  title: string;
  /** `page` rules can be judged from one page; `site` rules need the whole crawl. */
  scope: "page" | "site";
  why: string;
  impact: string;
  detection: string;
  falsePositives: string;
  fix: string;
};

const rule = (id: string, severity: Severity, scope: "page" | "site", title: string, why: string, impact: string, detection: string, falsePositives: string, fix: string): AuditRule => ({ id, version: 1, severity, scope, title, why, impact, detection, falsePositives, fix });

/** The rule catalog. Severities are defaults; a site can change or switch off any rule. */
export const AUDIT_RULES: AuditRule[] = [
  rule("HTTP_5XX", "critical", "page", "Server error", "The server failed to produce the page.", "Visitors and search engines get an error, and pages that keep failing drop out of search.", "The URL answered with a 5xx status.", "A brief outage during the crawl. Recheck the page before acting.", "Check the server or runtime logs for this URL."),
  rule("HTTP_4XX", "high", "site", "Linked page not found", "A page your site links to does not exist.", "Visitors hit a dead end and link value is lost.", "A URL linked from at least one crawled page answered with a 4xx status.", "Pages that are meant to be private and answer 401 or 403 to anonymous visitors.", "Restore the page, redirect it, or fix the links that point to it."),
  rule("BROKEN_INTERNAL_LINK", "high", "site", "Broken internal link", "This page links to a URL on your site that does not exist.", "The link is a dead end for visitors and crawlers.", "An in-scope link on the page leads to a 4xx response.", "Links to private pages that require sign-in.", "Update or remove the link."),
  rule("REDIRECT_CHAIN", "medium", "site", "Redirect chain", "A linked URL redirects more than once before reaching a page.", "Each extra hop slows the visit and can lose crawlers.", "The URL passed through two or more redirects.", "Chains caused by a login or locale step that cannot be shortened.", "Link straight to the final URL and collapse the redirects into one."),
  rule("REDIRECT_LOOP", "high", "page", "Redirect loop", "The URL redirects back to itself.", "The page can never load.", "A redirect returned to a URL already visited in the same request, or exceeded the hop limit.", "Loops that only occur without cookies.", "Correct the redirect rules."),
  rule("NOINDEX", "info", "page", "Page set to noindex", "The page asks search engines not to index it.", "It will not appear in search results. That is often intended.", "A robots meta tag or X-Robots-Tag header contains noindex. Raised to high when the page is also listed in a sitemap.", "Admin, cart, search-result and thank-you pages are usually noindex on purpose. Ignore those.", "If the page should be found in search, remove the noindex directive."),
  rule("ROBOTS_BLOCKED", "info", "page", "Blocked by robots.txt", "robots.txt tells crawlers not to fetch this URL.", "Search engines cannot read the page. That is often intended.", "The URL is disallowed for crawlers. Raised to high when it is also listed in a sitemap.", "Private or duplicate sections that are blocked on purpose.", "If the page matters for search, allow it in robots.txt."),
  rule("MISSING_TITLE", "high", "page", "Missing title", "The page has no title element.", "Search results and browser tabs have nothing meaningful to show.", "An indexable HTML page has no <title>.", "Titles added by JavaScript after load are not seen by this crawler.", "Add a descriptive title."),
  rule("EMPTY_TITLE", "high", "page", "Empty title", "The title element is blank.", "Search results fall back to guessed text.", "An indexable HTML page has a <title> with no text.", "Titles filled in by JavaScript after load.", "Write a title for the page."),
  rule("DUPLICATE_TITLE", "medium", "site", "Duplicate title", "Several indexable pages share the same title.", "Pages become hard to tell apart in search results.", "The same title, ignoring case and spacing, appears on more than one indexable URL.", "Paginated lists and near-identical variants that are meant to share a title.", "Give each page a title that says what is different about it."),
  rule("LONG_TITLE", "low", "page", "Long title", "The title is unusually long.", "Search results may cut it off. There is no fixed limit, so this is a prompt to review.", "The title is longer than 70 characters.", "Long titles that still read well when truncated.", "Put the most important words first."),
  rule("MISSING_META_DESC", "medium", "page", "Missing meta description", "The page has no meta description.", "Search engines write their own snippet, which may not be the summary you would choose.", "An indexable HTML page has no meta description, or an empty one.", "Pages where an automatic snippet is fine.", "Add a short, useful summary of the page."),
  rule("DUPLICATE_META_DESC", "low", "site", "Duplicate meta description", "Several pages reuse the same description.", "Snippets stop distinguishing the pages.", "The same description appears on more than one indexable URL.", "Template descriptions on low-priority pages.", "Write specific descriptions for the pages that matter."),
  rule("MULTIPLE_H1", "info", "page", "More than one H1", "The page has several top-level headings.", "Not a search problem in itself; it can blur the page's structure for readers and assistive technology.", "More than one <h1> element was found.", "Layouts that use H1 for the logo and the article heading.", "Review the heading structure."),
  rule("MISSING_H1", "low", "page", "No H1", "The page has no top-level heading.", "Readers and assistive technology have no clear page heading.", "An indexable HTML page has no <h1>.", "Headings rendered by JavaScript after load.", "Add a visible main heading."),
  rule("CANONICAL_MISSING", "low", "page", "No canonical", "The page does not declare a canonical URL.", "Search engines pick one themselves. That is fine for most pages; it matters when the same content is reachable at several URLs.", "An indexable HTML page has no rel=canonical link.", "Sites without duplicate URLs do not need one.", "Add a self-referencing canonical where duplicates are possible."),
  rule("CANONICAL_BROKEN", "high", "site", "Canonical points to a broken URL", "The declared canonical does not load.", "Search engines are told to prefer a page that does not exist.", "The canonical target answered with a 4xx or 5xx status, or could not be fetched.", "A brief outage during the crawl.", "Point the canonical at a working URL."),
  rule("CANONICAL_OFFSITE", "info", "page", "Canonical points to another site", "The canonical is on a different domain.", "This page hands its search presence to that domain.", "The canonical URL's host is not one of the site's hostnames.", "Syndicated content that should credit the original.", "Verify that this is intended."),
  rule("CANONICAL_CONFLICT", "high", "site", "Conflicting canonical", "The canonical signals contradict each other.", "Search engines may ignore the canonical altogether.", "The page declares several different canonicals, or its canonical target redirects, is noindex, or names a different canonical itself.", "None common.", "Choose one preferred URL and make every signal agree with it."),
  rule("SITEMAP_BROKEN", "high", "site", "Sitemap cannot be read", "A declared sitemap is unavailable or invalid.", "Search engines lose the list of URLs you want crawled.", "A sitemap named in robots.txt, in settings, or in a sitemap index did not return a valid sitemap.", "None common.", "Regenerate the sitemap and check the URL in robots.txt."),
  rule("SITEMAP_NONINDEXABLE", "medium", "site", "Sitemap lists a page that cannot be indexed", "The sitemap includes a URL that is broken, redirected or noindex.", "It sends mixed signals and wastes crawling.", "A URL from a sitemap answered with an error or a redirect, or carries noindex.", "None common.", "Remove the URL from the sitemap or fix the page."),
  rule("ALT_MISSING", "low", "page", "Images without alt text", "Some images have no alt attribute.", "Screen-reader users and image search get no description.", "At least one <img> has no alt attribute. An empty alt, which marks a decorative image, is accepted.", "Tracking pixels and decorative images that should carry an empty alt.", "Add meaningful alt text, or an empty alt for decorative images."),
  rule("INTERNAL_ORPHAN", "medium", "site", "No internal links to this page", "The page is in the sitemap but nothing links to it.", "Visitors cannot reach it by browsing, and it gets little internal link value.", "A sitemap URL had no internal inlinks in a complete crawl.", "Landing pages that are meant to be reached only from ads or email.", "Link to it from relevant pages."),
  rule("STRUCTURED_DATA_INVALID_JSON", "medium", "page", "Structured data is not valid JSON", "A JSON-LD block cannot be parsed.", "Search engines ignore the whole block.", "A script of type application/ld+json failed JSON parsing.", "None common.", "Fix the JSON syntax."),
  rule("HREFLANG_INVALID", "medium", "page", "Invalid hreflang", "An hreflang annotation is malformed.", "Search engines ignore it, so the wrong language version may be shown.", "An hreflang value is not a valid language code, or its URL is missing or not absolute.", "None common.", "Use valid language codes and absolute URLs."),
  rule("HTTPS_MIXED_CONTENT", "medium", "page", "Insecure resource on a secure page", "The HTTPS page references a resource over HTTP.", "Browsers block or warn about it.", "An image, script, stylesheet, frame or media source uses http://.", "None common.", "Load the resource over HTTPS."),
  rule("MISSING_VIEWPORT", "low", "page", "No mobile viewport", "The page has no viewport meta tag.", "Phones render it zoomed out at desktop width.", "No <meta name=viewport> was found.", "Viewport tags added by JavaScript.", "Add a responsive viewport meta tag."),
  rule("THIN_CONTENT_HEURISTIC", "info", "page", "Very little text", "The page has very little visible text in its HTML.", "This is a prompt for a human to look, not a verdict.", "An indexable HTML page has fewer than 50 words of static text.", "Pages that render their content with JavaScript, galleries and tools.", "Review whether the page says enough to be useful."),
];

export const RULE_BY_ID = new Map(AUDIT_RULES.map((r) => [r.id, r]));

export type Finding = {
  ruleId: string;
  url: string;
  /** Distinguishes several findings of one rule on one URL, e.g. each broken link target. */
  key?: string;
  /** Overrides the rule's default severity for this finding. */
  severity?: Severity;
  evidence: Record<string, unknown>;
};

const normTitle = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const directives = (page: CrawledPage) => `${page.facts?.robotsMeta ?? ""}, ${page.xRobotsTag ?? ""}`;
export const isNoindex = (page: CrawledPage) => /\b(noindex|none)\b/.test(directives(page));

/** A page search engines could index: it loads, is HTML, is not noindex or blocked, and does not canonicalize elsewhere. */
export function isIndexable(page: CrawledPage, params: readonly string[] = []): boolean {
  if (page.status !== 200 || !page.isHtml || !page.facts || page.robotsBlocked || isNoindex(page)) return false;
  const canonical = page.facts.canonicals[0];
  return !canonical || normalizeCrawlUrl(canonical, params) === page.url;
}

const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/i;

/**
 * Runs every rule over a finished crawl. Rules that need the whole site (duplicates,
 * orphans, sitemap checks) only produce findings from what was actually crawled; whether
 * their absence means "fixed" is decided later, from the crawl's coverage.
 */
export function evaluateCrawl(result: CrawlResult, opts: { hostnames: string[]; allowedQueryParams?: string[] }): Finding[] {
  const hosts = new Set(opts.hostnames.map((h) => h.toLowerCase()));
  const params = opts.allowedQueryParams ?? [];
  const findings: Finding[] = [];
  const add = (ruleId: string, url: string, evidence: Record<string, unknown>, extra: { key?: string; severity?: Severity } = {}) => findings.push({ ruleId, url, evidence, ...extra });
  const byUrl = new Map(result.pages.map((p) => [p.url, p]));
  const sources = new Map<string, string[]>();
  for (const link of result.links) {
    if (link.type !== "internal") continue;
    const list = sources.get(link.target) ?? [];
    if (list.length < 5) list.push(link.source);
    sources.set(link.target, list);
  }
  const indexable = result.pages.filter((p) => isIndexable(p, params));

  for (const page of result.pages) {
    const status = page.status ?? 0;
    const linkedFrom = sources.get(page.url) ?? [];
    if (page.robotsBlocked) {
      add("ROBOTS_BLOCKED", page.url, { inSitemap: page.inSitemap, linkedFrom }, page.inSitemap ? { severity: "high" } : {});
      continue;
    }
    if (page.redirectLoop) add("REDIRECT_LOOP", page.url, { chain: page.redirectChain });
    if (!page.redirectChain.length && status >= 500) add("HTTP_5XX", page.url, { status, linkedFrom });
    if (!page.redirectChain.length && status >= 400 && status < 500 && page.inlinks > 0) add("HTTP_4XX", page.url, { status, linkedFrom });
    if (page.redirectChain.length >= 2 && !page.redirectLoop && (page.inlinks > 0 || page.inSitemap)) add("REDIRECT_CHAIN", page.url, { hops: page.redirectChain.length, chain: page.redirectChain, finalUrl: page.finalUrl });
    if (page.inSitemap) {
      const reason = page.redirectChain.length ? `redirects to ${page.finalUrl ?? "another URL"}` : status >= 400 ? `returns HTTP ${status}` : page.fetchError ? `could not be fetched (${page.fetchError})` : isNoindex(page) ? "is set to noindex" : null;
      if (reason) add("SITEMAP_NONINDEXABLE", page.url, { reason });
    }
    const facts = page.facts;
    if (!facts || status !== 200) continue;

    if (isNoindex(page)) add("NOINDEX", page.url, { directive: directives(page).replace(/^, |, $/g, ""), inSitemap: page.inSitemap }, page.inSitemap ? { severity: "high" } : {});
    const canIndex = isIndexable(page, params);
    if (canIndex) {
      if (!facts.titles.length) add("MISSING_TITLE", page.url, {});
      else if (!facts.titles[0]) add("EMPTY_TITLE", page.url, {});
      else if (facts.titles[0].length > 70) add("LONG_TITLE", page.url, { title: facts.titles[0], length: facts.titles[0].length });
      if (!facts.metaDescriptions.some(Boolean)) add("MISSING_META_DESC", page.url, {});
      if (!facts.h1s.length) add("MISSING_H1", page.url, {});
      if (facts.wordCount < 50) add("THIN_CONTENT_HEURISTIC", page.url, { words: facts.wordCount });
    }
    if (facts.h1s.length > 1) add("MULTIPLE_H1", page.url, { count: facts.h1s.length, headings: facts.h1s.slice(0, 5) });
    if (!facts.hasViewport) add("MISSING_VIEWPORT", page.url, {});
    if (facts.imagesMissingAlt.count) add("ALT_MISSING", page.url, { images: facts.imagesMissingAlt.count, examples: facts.imagesMissingAlt.samples });
    if (facts.jsonLdErrors.length) add("STRUCTURED_DATA_INVALID_JSON", page.url, { errors: facts.jsonLdErrors });
    if (page.url.startsWith("https://") && facts.insecureResources.length) add("HTTPS_MIXED_CONTENT", page.url, { resources: facts.insecureResources.slice(0, 5), count: facts.insecureResources.length });
    const badHreflang = facts.hreflang.filter((h) => !HREFLANG.test(h.lang) || !/^https?:\/\//i.test(h.href));
    if (badHreflang.length) add("HREFLANG_INVALID", page.url, { entries: badHreflang.slice(0, 5) });

    /* Canonicals */
    const canonicals = [...new Set(facts.canonicals.map((c) => normalizeCrawlUrl(c, params) ?? c))];
    if (!canonicals.length) {
      if (!isNoindex(page)) add("CANONICAL_MISSING", page.url, {});
    } else if (canonicals.length > 1) {
      add("CANONICAL_CONFLICT", page.url, { reason: "The page declares more than one canonical", canonicals });
    } else {
      const canonical = canonicals[0]!;
      if (!inScope(canonical, hosts)) add("CANONICAL_OFFSITE", page.url, { canonical });
      else if (canonical !== page.url) {
        const target = byUrl.get(canonical);
        if (target) {
          const targetCanonical = target.facts?.canonicals[0] ? normalizeCrawlUrl(target.facts.canonicals[0], params) : null;
          if ((target.status ?? 0) >= 400 || target.fetchError) add("CANONICAL_BROKEN", page.url, { canonical, status: target.status, error: target.fetchError });
          else if (target.redirectChain.length) add("CANONICAL_CONFLICT", page.url, { reason: "The canonical target redirects", canonical, redirectsTo: target.finalUrl });
          else if (isNoindex(target)) add("CANONICAL_CONFLICT", page.url, { reason: "The canonical target is set to noindex", canonical });
          else if (targetCanonical && targetCanonical !== canonical) add("CANONICAL_CONFLICT", page.url, { reason: "The canonical target names a different canonical", canonical, targetCanonical });
        }
      }
    }
  }

  /* Links to missing pages, reported on the page that carries the link. */
  for (const link of result.links) {
    if (link.type !== "internal") continue;
    const target = byUrl.get(link.target);
    if (target && !target.redirectChain.length && (target.status ?? 0) >= 400 && (target.status ?? 0) < 500) add("BROKEN_INTERNAL_LINK", link.source, { target: link.target, status: target.status }, { key: link.target });
  }

  /* Duplicates across indexable pages. */
  const duplicates = (ruleId: string, valueOf: (page: CrawledPage) => string | undefined, label: string) => {
    const groups = new Map<string, CrawledPage[]>();
    for (const page of indexable) {
      const value = valueOf(page);
      if (!value) continue;
      const key = normTitle(value);
      groups.set(key, [...(groups.get(key) ?? []), page]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const page of group) add(ruleId, page.url, { [label]: valueOf(page), sharedWith: group.filter((p) => p !== page).slice(0, 5).map((p) => p.url), pages: group.length });
    }
  };
  duplicates("DUPLICATE_TITLE", (p) => p.facts?.titles[0], "title");
  duplicates("DUPLICATE_META_DESC", (p) => p.facts?.metaDescriptions.find(Boolean), "description");

  for (const sitemap of result.sitemaps) if (!sitemap.ok && sitemap.declared) add("SITEMAP_BROKEN", sitemap.url, { error: sitemap.error });

  // Without a complete crawl, a page with no inlinks may simply not have been reached yet.
  if (result.complete) {
    for (const page of result.pages) {
      if (page.inSitemap && page.inlinks === 0 && page.url !== result.homepage && page.status === 200 && !page.redirectChain.length) add("INTERNAL_ORPHAN", page.url, {});
    }
  }
  return findings;
}

/* ------------------------------ Score ------------------------------ */

export const SCORE_VERSION = 1;
export const SEVERITY_WEIGHTS: Record<Severity, number> = { critical: 30, high: 15, medium: 6, low: 2, info: 0 };

/** The smallest share a rule with open issues is counted at, so a huge site cannot round a real problem down to nothing. */
export const MIN_AFFECTED_SHARE = 0.1;

/**
 * 0 to 100 for a complete crawl. Each rule with open issues costs its severity weight times
 * the square root of the share of pages affected, with a floor, so one broken page on a
 * large site still counts and a site-wide problem does not sink the score on its own.
 * Not a Google rating.
 */
export function auditScore(openByRule: { severity: Severity; affected: number }[], eligiblePages: number): number {
  if (eligiblePages <= 0) return 100;
  const penalty = openByRule.reduce((sum, r) => sum + SEVERITY_WEIGHTS[r.severity] * Math.max(MIN_AFFECTED_SHARE, Math.sqrt(Math.min(1, r.affected / eligiblePages))), 0);
  return Math.max(0, Math.round(100 - penalty));
}

export type AuditHealth = "healthy" | "needs_attention" | "critical" | "insufficient_coverage" | "not_run";

export function auditHealth(input: { complete: boolean; open: Record<Severity, number>; score: number | null }): AuditHealth {
  if (input.open.critical > 0) return "critical";
  if (!input.complete) return "insufficient_coverage";
  if (input.open.high > 0 || (input.score ?? 100) < 80) return "needs_attention";
  return "healthy";
}

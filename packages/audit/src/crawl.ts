import type { CrawlStopReason } from "@scopekit/contracts";
import { createHash } from "node:crypto";
import { extractPage, parseSitemap, type PageFacts } from "./html";
import { fetchFollow, type FetchResult, type NetPolicy } from "./net";
import { isAllowedByRobots, parseRobots, type Robots } from "./robots";
import { inScope, isExcludedCrawlPath, normalizeCrawlUrl } from "./urls";

export const CRAWLER_VERSION = 1;

export type CrawlConfig = {
  /** Canonical origin, e.g. https://example.com. */
  origin: string;
  /** Hostnames the owner confirmed. Nothing outside them is fetched. */
  hostnames: string[];
  maxPages: number;
  sitemapUrl?: string | null;
  excludedPaths?: string[];
  allowedQueryParams?: string[];
  concurrency?: number;
  /** Minimum gap between request starts, across the whole site. 500 ms is two requests a second. */
  minIntervalMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxDurationMs?: number;
  /** Visit just this URL: no sitemaps, no link following. */
  only?: string;
  /** Tests only: lets the crawler reach a fixture server on loopback. */
  allowLoopback?: boolean;
};

export type CrawledPage = {
  url: string;
  depth: number;
  status: number | null;
  fetchError: string | null;
  /** URLs passed through before the final response, starting with this one. Empty when there was no redirect. */
  redirectChain: string[];
  redirectLoop: boolean;
  /** Where the redirects ended, in scope or not. */
  finalUrl: string | null;
  offsiteRedirect: boolean;
  contentType: string | null;
  responseMs: number | null;
  robotsBlocked: boolean;
  inSitemap: boolean;
  isHtml: boolean;
  xRobotsTag: string | null;
  facts: PageFacts | null;
  htmlHash: string | null;
  truncated: boolean;
  inlinks: number;
  outlinks: number;
};

export type CrawlLink = { source: string; target: string; type: "internal" | "canonical" | "redirect" };
export type SitemapReport = { url: string; ok: boolean; urls: number; declared: boolean; error?: string };

export type CrawlResult = {
  pages: CrawledPage[];
  links: CrawlLink[];
  sitemaps: SitemapReport[];
  robots: { found: boolean; status: number | null };
  homepage: string;
  discovered: number;
  crawled: number;
  /** Every discovered, allowed URL was visited. */
  complete: boolean;
  stopReason: CrawlStopReason;
  /** Set when the crawl could not start at all. */
  error: string | null;
};

export type CrawlHooks = {
  onProgress?: (progress: { discovered: number; crawled: number }) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
};

const TEXTUAL = /html|xml|text\/plain/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const blank = (url: string, depth: number): CrawledPage => ({
  url,
  depth,
  status: null,
  fetchError: null,
  redirectChain: [],
  redirectLoop: false,
  finalUrl: null,
  offsiteRedirect: false,
  contentType: null,
  responseMs: null,
  robotsBlocked: false,
  inSitemap: false,
  isHtml: false,
  xRobotsTag: null,
  facts: null,
  htmlHash: null,
  truncated: false,
  inlinks: 0,
  outlinks: 0,
});

/**
 * Breadth-first crawl of one site from its homepage and sitemaps. It only ever requests
 * the owner's confirmed hostnames, obeys robots.txt, sends no cookies, and stops at its
 * page, time and error limits. What it could not visit is reported as not visited.
 */
export async function crawlSite(config: CrawlConfig, hooks: CrawlHooks = {}): Promise<CrawlResult> {
  const hosts = new Set(config.hostnames.map((h) => h.toLowerCase()));
  const policy: NetPolicy = { allowedHosts: hosts, allowLoopback: config.allowLoopback };
  const params = config.allowedQueryParams ?? [];
  const excluded = config.excludedPaths ?? [];
  const request = { timeoutMs: config.timeoutMs ?? 10_000, maxBytes: config.maxBytes ?? 2_000_000, maxRedirects: config.maxRedirects ?? 5, wantBody: (type: string, status: number) => status === 200 && TEXTUAL.test(type) };
  const minInterval = config.minIntervalMs ?? 500;
  const startedAt = Date.now();
  const homepage = normalizeCrawlUrl(`${config.origin}/`, params)!;
  const empty = (error: string, robots = { found: false, status: null as number | null }): CrawlResult => ({ pages: [], links: [], sitemaps: [], robots, homepage, discovered: 0, crawled: 0, complete: false, stopReason: null, error });
  if (!inScope(homepage, hosts)) return empty("The site's address is not one of its confirmed hostnames");

  // One slot at a time: request starts are spaced out across all workers.
  let nextSlot = 0;
  const paced = async (url: string): Promise<FetchResult> => {
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(Date.now(), nextSlot) + minInterval;
    if (wait) await sleep(wait);
    return fetchFollow(url, policy, request);
  };

  /* robots.txt */
  const robotsFetch = await paced(new URL("/robots.txt", config.origin).toString());
  const robotsStatus = robotsFetch.response?.status ?? null;
  let robots: Robots = { groups: [], sitemaps: [] };
  // Like Google: a missing robots.txt allows everything, an unreadable one allows nothing.
  if (robotsFetch.failure || (robotsStatus !== null && robotsStatus >= 500)) {
    return empty(robotsFetch.failure === "blocked_address" ? "The site resolves to an address the crawler may not connect to" : "robots.txt could not be read, so nothing was crawled", { found: false, status: robotsStatus });
  }
  if (robotsStatus === 200 && robotsFetch.response?.body) robots = parseRobots(robotsFetch.response.body.toString("utf8"));
  const allowed = (url: string) => {
    const parsed = new URL(url);
    return isAllowedByRobots(robots, parsed.pathname + parsed.search);
  };
  const crawlable = (url: string) => inScope(url, hosts) && !isExcludedCrawlPath(new URL(url).pathname, excluded);

  /* Sitemaps: the ones robots.txt lists, the configured one, and /sitemap.xml as a quiet default. */
  const sitemapUrls = new Set<string>();
  const sitemaps: SitemapReport[] = [];
  const declared = [...robots.sitemaps, ...(config.sitemapUrl ? [config.sitemapUrl] : [])];
  const pending = config.only ? [] : (declared.length ? declared : [new URL("/sitemap.xml", config.origin).toString()]).map((url) => ({ url, declared: declared.length > 0 }));
  const seenSitemaps = new Set<string>();
  const urlCap = config.maxPages * 5;
  while (pending.length && seenSitemaps.size < 20) {
    const item = pending.shift()!;
    if (seenSitemaps.has(item.url)) continue;
    seenSitemaps.add(item.url);
    if (!inScope(item.url, hosts)) {
      sitemaps.push({ url: item.url, ok: false, urls: 0, declared: item.declared, error: "It is hosted outside the site's confirmed hostnames" });
      continue;
    }
    const fetched = await fetchFollow(item.url, policy, { ...request, wantBody: (_type, status) => status === 200 });
    const status = fetched.response?.status;
    if (status !== 200 || !fetched.response?.body) {
      // A default /sitemap.xml that does not exist is not a broken sitemap.
      if (item.declared) sitemaps.push({ url: item.url, ok: false, urls: 0, declared: true, error: fetched.failure ? `Request failed (${fetched.failure})` : `Returned HTTP ${status ?? "nothing"}` });
      continue;
    }
    const doc = parseSitemap(fetched.response.body.toString("utf8"));
    if (doc.type === "invalid") {
      sitemaps.push({ url: item.url, ok: false, urls: 0, declared: item.declared, error: "It is not a sitemap or sitemap index" });
    } else if (doc.type === "index") {
      sitemaps.push({ url: item.url, ok: true, urls: 0, declared: item.declared });
      for (const loc of doc.locs) pending.push({ url: loc, declared: true });
    } else {
      let count = 0;
      for (const loc of doc.locs) {
        const normalized = normalizeCrawlUrl(loc, params);
        if (normalized && crawlable(normalized) && sitemapUrls.size < urlCap) {
          sitemapUrls.add(normalized);
          count++;
        }
      }
      sitemaps.push({ url: item.url, ok: true, urls: count, declared: item.declared, ...(fetched.response.truncated ? { error: "The file was larger than the download cap, so only part of it was read" } : {}) });
    }
  }

  /* Crawl */
  const pages = new Map<string, CrawledPage>();
  const links = new Map<string, CrawlLink>();
  const queue: { url: string; depth: number }[] = [];
  const known = new Set<string>();
  const discoveryCap = config.maxPages * 10;
  const enqueue = (url: string, depth: number) => {
    if (known.has(url) || known.size >= discoveryCap) return;
    known.add(url);
    queue.push({ url, depth });
  };
  const addLink = (source: string, target: string, type: CrawlLink["type"]) => {
    if (source !== target) links.set(`${type}\u001f${source}\u001f${target}`, { source, target, type });
  };
  const only = config.only ? normalizeCrawlUrl(config.only, params) : null;
  if (config.only && (!only || !crawlable(only))) return empty("This URL is not part of the site");
  enqueue(only ?? homepage, 0);
  for (const url of sitemapUrls) enqueue(url, 1);

  let crawled = 0;
  let attempts = 0;
  let failures = 0;
  let stopReason: CrawlStopReason = null;
  let active = 0;

  const visit = async ({ url, depth }: { url: string; depth: number }) => {
    const page = blank(url, depth);
    page.inSitemap = sitemapUrls.has(url);
    pages.set(url, page);
    if (!allowed(url)) {
      page.robotsBlocked = true;
      return;
    }
    crawled++;
    attempts++;
    const result = await paced(url);
    page.responseMs = result.ms;
    page.redirectChain = result.chain.map((hop) => hop.url);
    if (result.failure) {
      page.fetchError = result.failure;
      page.redirectLoop = result.failure === "redirect_loop";
      if (result.failure === "timeout" || result.failure === "network") failures++;
      if (result.chain[0]) page.status = result.chain[0].status;
      return;
    }
    if (result.offsiteTarget) {
      page.status = result.chain[0]?.status ?? null;
      page.finalUrl = result.offsiteTarget;
      page.offsiteRedirect = true;
      return;
    }
    const response = result.response!;
    // The page that answered is recorded under its own URL; the URL that redirected only keeps the hop.
    let target = page;
    if (result.chain.length) {
      const finalUrl = normalizeCrawlUrl(response.url, params) ?? response.url;
      page.status = result.chain[0]!.status;
      page.finalUrl = finalUrl;
      addLink(url, finalUrl, "redirect");
      if (!crawlable(finalUrl) || pages.has(finalUrl)) return;
      known.add(finalUrl);
      target = blank(finalUrl, depth);
      target.inSitemap = sitemapUrls.has(finalUrl);
      target.responseMs = response.ms;
      pages.set(finalUrl, target);
    }
    target.status = response.status;
    target.contentType = (response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase() || null;
    target.xRobotsTag = response.headers["x-robots-tag"]?.toLowerCase() ?? null;
    target.truncated = response.truncated;
    target.isHtml = /html/i.test(target.contentType ?? "");
    if (!target.isHtml || response.status !== 200 || !response.body) return;
    const html = response.body.toString("utf8");
    target.htmlHash = createHash("sha256").update(html).digest("hex").slice(0, 32);
    target.facts = extractPage(html, target.url);
    const outgoing = new Set<string>();
    for (const link of target.facts.links) {
      const normalized = normalizeCrawlUrl(link.href, params);
      if (!normalized || !crawlable(normalized) || normalized === target.url) continue;
      outgoing.add(normalized);
    }
    target.outlinks = outgoing.size;
    if (only) return;
    for (const next of outgoing) {
      addLink(target.url, next, "internal");
      enqueue(next, depth + 1);
    }
    for (const canonical of target.facts.canonicals) {
      const normalized = normalizeCrawlUrl(canonical, params);
      if (normalized && crawlable(normalized)) {
        addLink(target.url, normalized, "canonical");
        enqueue(normalized, depth + 1);
      }
    }
  };

  const worker = async () => {
    for (;;) {
      if (stopReason) return;
      const next = queue.shift();
      if (!next) {
        if (active === 0) return;
        await sleep(25);
        continue;
      }
      if (pages.has(next.url)) continue;
      if (crawled >= config.maxPages) {
        queue.unshift(next);
        stopReason = "page_limit";
        return;
      }
      if (Date.now() - startedAt > (config.maxDurationMs ?? 30 * 60_000)) {
        queue.unshift(next);
        stopReason = "time_limit";
        return;
      }
      if (attempts >= 20 && failures / attempts > 0.5) {
        queue.unshift(next);
        stopReason = "error_budget";
        return;
      }
      active++;
      try {
        await visit(next);
      } finally {
        active--;
      }
      if (crawled % 5 === 0) {
        await hooks.onProgress?.({ discovered: known.size, crawled });
        if (await hooks.shouldCancel?.()) stopReason = "cancelled";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, config.concurrency ?? 2) }, worker));

  const remaining = queue.filter((item) => !pages.has(item.url)).length;
  for (const link of links.values()) {
    if (link.type !== "internal") continue;
    const target = pages.get(link.target);
    if (target) target.inlinks++;
  }
  return {
    pages: [...pages.values()],
    links: [...links.values()],
    sitemaps,
    robots: { found: robotsStatus === 200, status: robotsStatus },
    homepage,
    discovered: known.size,
    crawled,
    complete: stopReason === null && remaining === 0,
    stopReason,
    error: null,
  };
}

/** A fresh look at one URL: same robots check, same fetch, same parsing, no link following. */
export function crawlPage(config: CrawlConfig, url: string): Promise<CrawlResult> {
  return crawlSite({ ...config, maxPages: 2, only: url });
}

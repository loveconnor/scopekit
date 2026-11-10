import type { CrawlStatus, CrawlSummary, Severity } from "@scopekit/contracts";
import {
  applyFindings,
  finishCrawlRun,
  getCrawlRun,
  getSite,
  listRuleSettings,
  openIssueCounts,
  openIssuesByRule,
  pruneCrawlData,
  reportCrawlProgress,
  saveCrawlPages,
  schema,
  type Database,
  type ResolvedFinding,
} from "@scopekit/db";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { crawlPage, crawlSite, CRAWLER_VERSION, type CrawlConfig, type CrawlResult } from "./crawl";
import { AUDIT_RULES, auditScore, evaluateCrawl, isIndexable, isNoindex, RULE_BY_ID, SCORE_VERSION } from "./rules";

export type RunCrawlOptions = Pick<CrawlConfig, "allowLoopback" | "minIntervalMs" | "concurrency" | "timeoutMs" | "maxDurationMs"> & {
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

const PAGE_RULES = AUDIT_RULES.filter((r) => r.scope === "page").map((r) => r.id);

/**
 * Executes one queued crawl run from start to finish: crawl, evaluate, store the page
 * inventory, update issues, and write the run's summary. Safe to call for a run that was
 * cancelled meanwhile; it then stores what it has and marks the run cancelled.
 */
export async function runCrawl(db: Database, runId: string, options: RunCrawlOptions = {}): Promise<{ status: CrawlStatus; pages: number; newIssues: number; resolvedIssues: number }> {
  const run = await getCrawlRun(db, runId);
  if (!run) return { status: "error", pages: 0, newIssues: 0, resolvedIssues: 0 };
  const fail = async (message: string) => {
    await finishCrawlRun(db, runId, { status: "error", pagesDiscovered: 0, pagesCrawled: 0, coverageComplete: false, errorSummary: message });
    return { status: "error" as const, pages: 0, newIssues: 0, resolvedIssues: 0 };
  };
  const site = await getSite(db, run.siteId, { includeDemo: false });
  if (!site) return fail("The site no longer exists");

  const config: CrawlConfig = {
    origin: site.canonicalOrigin,
    hostnames: site.hostnames,
    maxPages: run.maxPages,
    sitemapUrl: site.settings.sitemapUrl,
    excludedPaths: site.settings.crawlExcludedPaths,
    allowedQueryParams: site.settings.allowedQueryParams,
    allowLoopback: options.allowLoopback,
    minIntervalMs: options.minIntervalMs,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    maxDurationMs: options.maxDurationMs,
  };
  const configHash = createHash("sha256")
    .update(JSON.stringify([config.origin, config.hostnames, config.maxPages, config.sitemapUrl, config.excludedPaths, config.allowedQueryParams]))
    .digest("hex")
    .slice(0, 16);

  let cancelRequested = false;
  let result: CrawlResult;
  try {
    result =
      run.kind === "recheck" && run.targetUrl
        ? await crawlPage(config, run.targetUrl)
        : await crawlSite(config, {
            onProgress: async (progress) => {
              cancelRequested = (await reportCrawlProgress(db, runId, progress)).cancel;
            },
            shouldCancel: () => cancelRequested,
          });
  } catch (error) {
    return fail(`The crawler stopped unexpectedly: ${(error as Error).message}`);
  }
  if (result.error) return fail(result.error);

  const settings = await listRuleSettings(db, site.id);
  const disabled = settings.filter((s) => !s.enabled).map((s) => s.ruleId);
  const overrides = new Map(settings.filter((s) => s.severity).map((s) => [s.ruleId, s.severity as Severity]));

  // A recheck has no sitemap in hand, so the page keeps what the last full crawl knew about it.
  if (run.kind === "recheck") {
    const [known] = await db
      .select({ inSitemap: schema.crawlPages.inSitemap, inlinks: schema.crawlPages.internalInlinkCount })
      .from(schema.crawlPages)
      .where(and(eq(schema.crawlPages.siteId, site.id), eq(schema.crawlPages.url, result.pages[0]?.url ?? "")))
      .orderBy(desc(schema.crawlPages.detectedAt))
      .limit(1);
    if (known && result.pages[0]) {
      result.pages[0].inSitemap = known.inSitemap;
      result.pages[0].inlinks = known.inlinks;
    }
  }

  const findings: ResolvedFinding[] = evaluateCrawl(result, { hostnames: site.hostnames, allowedQueryParams: site.settings.allowedQueryParams })
    .filter((f) => !disabled.includes(f.ruleId) && (run.kind === "full" || PAGE_RULES.includes(f.ruleId)))
    .map((f) => ({ ruleId: f.ruleId, url: f.url, key: f.key, evidence: f.evidence, severity: overrides.get(f.ruleId) ?? f.severity ?? RULE_BY_ID.get(f.ruleId)!.severity }));

  const issuesPerUrl = new Map<string, number>();
  for (const f of findings) issuesPerUrl.set(f.url, (issuesPerUrl.get(f.url) ?? 0) + 1);
  const unverified = result.pages.filter((p) => p.fetchError === "timeout" || p.fetchError === "network").map((p) => p.url);

  if (run.kind === "full") {
    await saveCrawlPages(
      db,
      { id: runId, siteId: site.id },
      result.pages.map((p) => ({
        url: p.url,
        finalUrl: p.finalUrl,
        statusCode: p.status,
        fetchError: p.fetchError,
        redirectHops: p.redirectChain.length,
        contentType: p.contentType,
        responseMs: p.responseMs,
        robotsBlocked: p.robotsBlocked,
        inSitemap: p.inSitemap,
        indexable: isIndexable(p, site.settings.allowedQueryParams),
        title: p.facts?.titles[0]?.slice(0, 500) ?? null,
        metaDescription: p.facts?.metaDescriptions.find(Boolean)?.slice(0, 1000) ?? null,
        canonical: p.facts?.canonicals[0]?.slice(0, 2000) ?? null,
        robotsMeta: p.facts ? (isNoindex(p) ? "noindex" : (p.facts.robotsMeta ?? p.xRobotsTag)) : p.xRobotsTag,
        h1: p.facts?.h1s[0] ?? null,
        h1Count: p.facts?.h1s.length ?? null,
        wordCount: p.facts?.wordCount ?? null,
        internalInlinkCount: p.inlinks,
        internalOutlinkCount: p.outlinks,
        issueCount: issuesPerUrl.get(p.url) ?? 0,
        htmlHash: p.htmlHash,
        depth: p.depth,
      })),
      result.links.map((l) => ({ sourceUrl: l.source, targetUrl: l.target, linkType: l.type })),
    );
  }

  const { newIssues, resolvedIssues } = await applyFindings(db, {
    siteId: site.id,
    runId,
    complete: run.kind === "full" && result.complete,
    findings,
    crawledUrls: result.pages.filter((p) => !unverified.includes(p.url)).map((p) => p.url),
    pageRuleIds: PAGE_RULES,
    disabledRuleIds: disabled,
    unverifiedUrls: unverified,
  });

  const open = await openIssueCounts(db, site.id);
  const eligiblePages = result.pages.filter((p) => p.status === 200 && p.isHtml).length;
  const complete = run.kind === "full" && result.complete;
  const summary: CrawlSummary = {
    open,
    newIssues,
    resolvedIssues,
    // A score from a partial crawl would describe the part that happened to be visited.
    score: complete ? auditScore(await openIssuesByRule(db, site.id), eligiblePages) : null,
    scoreVersion: SCORE_VERSION,
    eligiblePages,
    stopReason: result.stopReason,
    sitemaps: result.sitemaps.map(({ url, ok, urls, error }) => ({ url, ok, urls, ...(error ? { error } : {}) })),
    robots: result.robots,
  };
  const status: CrawlStatus = result.stopReason === "cancelled" ? "cancelled" : run.kind === "recheck" || result.complete ? "done" : "partial";
  await finishCrawlRun(db, runId, {
    status,
    pagesDiscovered: result.discovered,
    pagesCrawled: result.crawled,
    coverageComplete: complete,
    summary,
    configHash,
    crawlerVersion: CRAWLER_VERSION,
    errorSummary:
      result.stopReason === "error_budget" ? "Stopped early: most requests were failing" : result.stopReason === "time_limit" ? "Stopped at the time limit" : null,
  });
  if (run.kind === "full") await pruneCrawlData(db, site.id);
  options.log?.("crawl finished", { runId, siteId: site.id, status, pages: result.crawled, newIssues, resolvedIssues });
  return { status, pages: result.crawled, newIssues, resolvedIssues };
}

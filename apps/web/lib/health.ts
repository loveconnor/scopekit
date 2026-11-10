import "server-only";
import type { Severity } from "@scopekit/contracts";
import { AUDIT_RULES, auditHealth, RULE_BY_ID, type AuditHealth, type AuditRule } from "@scopekit/audit";
import { activeCrawl, getDb, latestCrawlsForSites, listFullCrawls, listRuleSettings, openIssueCounts, openIssueCountsForSites, type CrawlRun, type SiteDetail } from "@scopekit/db";
import { performanceConfigFromEnv } from "@scopekit/health";
import { cache } from "react";
import { requireUser } from "./session";

/** Lab runs a site may start per day, scheduled ones included. */
export const PERFORMANCE_DAILY_CAP = 30;
export const performanceConfigured = () => performanceConfigFromEnv() !== null;

export const SEVERITY_LABELS: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info" };
export const HEALTH_LABELS: Record<AuditHealth, string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  critical: "Critical",
  insufficient_coverage: "Insufficient coverage",
  not_run: "No audit yet",
};
export const ZERO_COUNTS: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

export type EffectiveRule = AuditRule & { enabled: boolean; defaultSeverity: Severity };

/** The catalog with this site's switches and severity overrides applied. */
export async function effectiveRules(siteId: string): Promise<EffectiveRule[]> {
  const settings = new Map((await listRuleSettings(getDb(), siteId)).map((s) => [s.ruleId, s]));
  return AUDIT_RULES.map((rule) => {
    const setting = settings.get(rule.id);
    return { ...rule, defaultSeverity: rule.severity, severity: setting?.severity ?? rule.severity, enabled: setting?.enabled ?? true };
  });
}

export const ruleTitle = (ruleId: string) => RULE_BY_ID.get(ruleId)?.title ?? ruleId;

export type AuditState = {
  /** Newest finished full crawl, whatever its outcome. */
  latest: CrawlRun | null;
  /** Newest crawl that stored pages. */
  latestWithPages: CrawlRun | null;
  previous: CrawlRun | null;
  active: CrawlRun | null;
  open: Record<Severity, number>;
  health: AuditHealth;
};

export const loadAuditState = cache(async (siteId: string): Promise<AuditState> => {
  await requireUser();
  const db = getDb();
  const [runs, active, open] = await Promise.all([listFullCrawls(db, siteId, 6), activeCrawl(db, siteId), openIssueCounts(db, siteId)]);
  const withPages = runs.filter((r) => r.status !== "error");
  const latestWithPages = withPages[0] ?? null;
  return {
    latest: runs[0] ?? null,
    latestWithPages,
    previous: withPages[1] ?? null,
    active,
    open,
    health: latestWithPages ? auditHealth({ complete: latestWithPages.coverageComplete, open, score: latestWithPages.summary?.score ?? null }) : "not_run",
  };
});

/** Audit status per site for the portfolio. Sites that were never crawled are absent, not healthy. */
export async function portfolioAudit(siteIds: string[]): Promise<{ bySite: Map<string, { health: AuditHealth; critical: number; open: number }>; critical: number | null }> {
  const db = getDb();
  const [runs, counts] = await Promise.all([latestCrawlsForSites(db, siteIds), openIssueCountsForSites(db, siteIds)]);
  const bySite = new Map<string, { health: AuditHealth; critical: number; open: number }>();
  for (const [siteId, run] of runs) {
    const open = counts.get(siteId) ?? ZERO_COUNTS;
    bySite.set(siteId, { health: auditHealth({ complete: run.coverageComplete, open, score: run.summary?.score ?? null }), critical: open.critical, open: Object.values(open).reduce((a, b) => a + b, 0) - open.info });
  }
  return { bySite, critical: bySite.size ? [...bySite.values()].reduce((sum, s) => sum + s.critical, 0) : null };
}

/** Whether a URL belongs to the site, by its confirmed hostnames. */
export function urlOnSite(site: SiteDetail, raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return site.hostnames.includes(url.host.toLowerCase()) || site.hostnames.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const pathOfUrl = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

import { addDays, localDateOf } from "@scopekit/analytics";
import type { AlertType } from "@scopekit/contracts";
import {
  activeDaysBefore,
  cruxSeries,
  expireAlertSnoozes,
  finishPerformanceRun,
  getCrawlRun,
  getPerformanceRun,
  gscTotals,
  listAlertRules,
  listPropertiesForSites,
  listSites,
  newCriticalIssues,
  performanceHistory,
  prunePerformanceRaw,
  raiseAlert,
  resolveClearedAlerts,
  schema,
  setCruxStatus,
  upsertCruxHistory,
  type Alert,
  type AlertCandidate,
  type Database,
} from "@scopekit/db";
import { eq, inArray } from "drizzle-orm";
import { ALERT_DEFAULTS, cwvDeterioration, lighthouseRegression, searchClickDrop, trackingStopped } from "./alerts";
import { fetchCruxHistory, ProviderError, runPageSpeed, type PerformanceConfig } from "./providers";

/** Runs one queued lab run and stores the result, or the reason it failed. */
export async function runPerformanceRun(db: Database, runId: string, config: PerformanceConfig): Promise<"done" | "error" | "skipped"> {
  const run = await getPerformanceRun(db, runId);
  if (!run || run.status !== "running") return "skipped";
  try {
    const result = await runPageSpeed(config, run.url, run.device);
    await finishPerformanceRun(db, runId, { status: "done", ...result });
    await prunePerformanceRaw(db, run.siteId);
    return "done";
  } catch (error) {
    await finishPerformanceRun(db, runId, { status: "error", error: error instanceof ProviderError ? error.message : "The run failed unexpectedly" });
    return "error";
  }
}

/** Imports the weekly real-user history for an origin, and records when Chrome has none. */
export async function syncCrux(db: Database, site: { siteId: string; origin: string }, config: PerformanceConfig): Promise<{ PHONE: string; DESKTOP: string }> {
  const status = { checkedAt: new Date().toISOString(), PHONE: "error" as "ok" | "no_data" | "error", DESKTOP: "error" as "ok" | "no_data" | "error" };
  for (const formFactor of ["PHONE", "DESKTOP"] as const) {
    try {
      const periods = await fetchCruxHistory(config, site.origin, formFactor);
      if (!periods || !periods.length) {
        status[formFactor] = "no_data";
        continue;
      }
      await upsertCruxHistory(db, periods.map((p) => ({ siteId: site.siteId, key: site.origin, formFactor, ...p, lcpP75: p.lcpP75 === null ? null : Math.round(p.lcpP75), inpP75: p.inpP75 === null ? null : Math.round(p.inpP75) })));
      status[formFactor] = "ok";
    } catch {
      // The provider being down leaves the stored history as it is.
    }
  }
  await setCruxStatus(db, site.siteId, status);
  return status;
}

export type EvaluateResult = { raised: Alert[]; resolved: number };

/**
 * Evaluates every alert rule for every real site. Raising is idempotent, so running this
 * hourly cannot produce duplicates.
 */
export async function evaluateAlerts(db: Database, opts: { now?: Date } = {}): Promise<EvaluateResult> {
  const now = opts.now ?? new Date();
  await expireAlertSnoozes(db);
  const sites = await listSites(db, { includeDemo: false });
  if (!sites.length) return { raised: [], resolved: 0 };
  const siteIds = sites.map((s) => s.id);
  const [settings, properties] = await Promise.all([
    db.select({ siteId: schema.siteSettings.siteId, trackingEnabled: schema.siteSettings.trackingEnabled }).from(schema.siteSettings).where(inArray(schema.siteSettings.siteId, siteIds)),
    listPropertiesForSites(db, siteIds),
  ]);
  const tracking = new Map(settings.map((s) => [s.siteId, s.trackingEnabled]));
  const raised: Alert[] = [];
  let resolved = 0;

  for (const site of sites) {
    const rules = await listAlertRules(db, site.id);
    const on = (type: AlertType) => rules.find((r) => r.type === type)?.enabled ?? true;
    const base = { siteId: site.id, siteName: site.name };
    const candidates: AlertCandidate[] = [];

    /* Tracking stopped. It clears itself as soon as an event arrives. */
    if (on("tracking_stopped")) {
      const lastDate = site.lastEventAt ? localDateOf(site.lastEventAt, site.timezone) : null;
      const candidate = trackingStopped({
        ...base,
        lastEventAt: site.lastEventAt,
        lastEventLocalDate: lastDate,
        activeDaysBefore: lastDate ? await activeDaysBefore(db, site.id, lastDate) : 0,
        trackingEnabled: tracking.get(site.id) ?? true,
        now,
      });
      if (candidate) candidates.push(candidate);
      else resolved += await resolveClearedAlerts(db, site.id, "tracking_stopped", []);
    }

    /* Search Console: lost access, and a drop over finalized weeks. */
    const own = properties.filter((p) => p.siteId === site.id && !p.isDemo);
    if (on("integration_disconnected")) {
      const lost = own.filter((p) => p.connectionStatus === "needs_reauth");
      for (const property of lost) {
        candidates.push({
          ...base,
          type: "integration_disconnected",
          entity: property.id,
          window: "current",
          severity: "warning",
          headline: `Search Console for ${site.name} needs reconnecting`,
          evidence: { property: property.externalPropertyId, dataThrough: property.finalizedThrough, reason: property.connectionError },
        });
      }
      resolved += await resolveClearedAlerts(db, site.id, "integration_disconnected", lost.map((p) => p.id));
    }
    const property = own.find((p) => p.finalizedThrough);
    if (on("search_click_drop") && property?.finalizedThrough) {
      const days = ALERT_DEFAULTS.search_click_drop.windowDays;
      const window = { from: addDays(property.finalizedThrough, -(days - 1)), to: property.finalizedThrough };
      const [current, previous] = await Promise.all([
        gscTotals(db, property.id, window.from, window.to),
        gscTotals(db, property.id, addDays(window.from, -days), addDays(window.from, -1)),
      ]);
      const candidate = searchClickDrop({ ...base, propertyId: property.id, current, previous, window });
      if (candidate) candidates.push(candidate);
    }

    /* Lab regression on the homepage, mobile. */
    if (on("lighthouse_regression")) {
      const url = `${site.canonicalOrigin}/`;
      const runs = (await performanceHistory(db, site.id, url, "mobile", 6)).filter((r) => r.status === "done").slice(0, 3);
      const candidate = lighthouseRegression({ ...base, url, runs: runs.map((r) => ({ checkedAt: r.checkedAt, lighthouseVersion: r.lighthouseVersion, performance: r.scores?.performance ?? null })) });
      if (candidate) candidates.push(candidate);
    }

    /* Field data moving into a worse band. */
    if (on("cwv_deterioration")) {
      const series = await cruxSeries(db, site.id, "PHONE", 2);
      const [previous, latest] = series.length === 2 ? series : [];
      if (previous && latest) {
        candidates.push(
          ...cwvDeterioration({
            ...base,
            periodEnd: latest.periodEnd,
            latest: { lcp: latest.lcpP75, inp: latest.inpP75, cls: latest.clsP75 },
            previous: { lcp: previous.lcpP75, inp: previous.inpP75, cls: previous.clsP75 },
          }),
        );
      }
    }

    for (const candidate of candidates) {
      const alert = await raiseAlert(db, candidate);
      if (alert) raised.push(alert);
    }
  }
  return { raised, resolved };
}

/** Right after a complete crawl: one alert per rule that produced a new critical issue. */
export async function alertsForCrawl(db: Database, runId: string): Promise<Alert[]> {
  const run = await getCrawlRun(db, runId);
  // A partial crawl cannot tell new from not-yet-visited, so it raises nothing.
  if (!run || run.kind !== "full" || !run.coverageComplete) return [];
  const [site] = await db.select({ name: schema.sites.name, isDemo: schema.sites.isDemo }).from(schema.sites).where(eq(schema.sites.id, run.siteId));
  if (!site || site.isDemo) return [];
  const rules = await listAlertRules(db, run.siteId);
  if (rules.find((r) => r.type === "new_critical_issue")?.enabled === false) return [];
  const raised: Alert[] = [];
  for (const found of await newCriticalIssues(db, runId)) {
    const alert = await raiseAlert(db, {
      siteId: run.siteId,
      type: "new_critical_issue",
      entity: found.ruleId,
      window: runId,
      severity: "critical",
      headline: `${found.count} new critical audit ${found.count === 1 ? "issue" : "issues"} on ${site.name}`,
      evidence: { rule: found.ruleId, pages: found.count, example: found.urls[0] ?? null },
    });
    if (alert) raised.push(alert);
  }
  return raised;
}

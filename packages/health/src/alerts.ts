import { CWV_THRESHOLDS, rateCwv, type AlertType, type CwvMetric, type CwvRating } from "@scopekit/contracts";
import type { AlertCandidate } from "@scopekit/db";

/** Defaults for every rule, in one place. */
export const ALERT_DEFAULTS = {
  tracking_stopped: { quietHours: 24, minActiveDays: 3 },
  search_click_drop: { windowDays: 7, minDrop: 0.3, minAbsoluteDrop: 30, cooldownDays: 7 },
  lighthouse_regression: { minPoints: 15, consecutiveRuns: 2 },
} as const;

export const ALERT_LABELS: Record<AlertType, { label: string; description: string }> = {
  tracking_stopped: { label: "Tracking stopped", description: "A site that normally has traffic has sent no event for 24 hours" },
  search_click_drop: { label: "Search clicks dropped", description: "Clicks over 7 finalized days are down more than 30% and at least 30 against the 7 days before" },
  new_critical_issue: { label: "New critical audit issue", description: "A complete crawl found a critical issue that was not there before" },
  lighthouse_regression: { label: "Lighthouse regression", description: "The mobile performance score is at least 15 points lower on two runs in a row" },
  cwv_deterioration: { label: "Core Web Vitals got worse", description: "A real-user p75 value moved into a worse band than the period before" },
  integration_disconnected: { label: "Search Console disconnected", description: "Google access was revoked or expired, so search data has stopped updating" },
};

type Base = { siteId: string; siteName: string };

/**
 * A site that had traffic and then went silent. A site that has never sent an event, or
 * only did so on a day or two, is not "stopped": it has no baseline to stop from.
 */
export function trackingStopped(input: Base & { lastEventAt: Date | null; lastEventLocalDate: string | null; activeDaysBefore: number; trackingEnabled: boolean; now: Date }): AlertCandidate | null {
  const { quietHours, minActiveDays } = ALERT_DEFAULTS.tracking_stopped;
  if (!input.trackingEnabled || !input.lastEventAt || !input.lastEventLocalDate) return null;
  const hours = (input.now.getTime() - input.lastEventAt.getTime()) / 3_600_000;
  if (hours < quietHours || input.activeDaysBefore < minActiveDays) return null;
  return {
    siteId: input.siteId,
    type: "tracking_stopped",
    entity: "",
    window: input.lastEventLocalDate,
    severity: "critical",
    headline: `${input.siteName} has sent no events for ${Math.floor(hours)} hours`,
    evidence: { lastEventAt: input.lastEventAt.toISOString(), hoursSilent: Math.floor(hours), activeDaysInWeekBefore: input.activeDaysBefore },
  };
}

/** Finalized week against the finalized week before it. Both the share and the absolute drop must be met. */
export function searchClickDrop(input: Base & { propertyId: string; current: { clicks: number; days: number }; previous: { clicks: number; days: number }; window: { from: string; to: string } }): AlertCandidate | null {
  const { windowDays, minDrop, minAbsoluteDrop, cooldownDays } = ALERT_DEFAULTS.search_click_drop;
  // Without every day of both weeks stored, the comparison would be between unequal periods.
  if (input.previous.days < windowDays || input.previous.clicks <= 0) return null;
  const drop = input.previous.clicks - input.current.clicks;
  if (drop < minAbsoluteDrop || drop / input.previous.clicks <= minDrop) return null;
  return {
    siteId: input.siteId,
    type: "search_click_drop",
    entity: input.propertyId,
    window: input.window.to,
    severity: "warning",
    headline: `Search clicks for ${input.siteName} are down ${Math.round((drop / input.previous.clicks) * 100)}% over 7 finalized days`,
    evidence: { clicks: input.current.clicks, previousClicks: input.previous.clicks, from: input.window.from, to: input.window.to },
    cooldownDays,
  };
}

const major = (version: string | null) => version?.split(".")[0] ?? "";

/**
 * Two consecutive mobile runs, both well below the run before them, all on the same
 * Lighthouse major version. One low run is noise; a version change moves scores by itself.
 */
export function lighthouseRegression(input: Base & { url: string; runs: { checkedAt: Date | null; lighthouseVersion: string | null; performance: number | null }[] }): AlertCandidate | null {
  const { minPoints } = ALERT_DEFAULTS.lighthouse_regression;
  const [latest, prior, baseline] = input.runs;
  if (!latest || !prior || !baseline || latest.performance === null || prior.performance === null || baseline.performance === null) return null;
  if (major(latest.lighthouseVersion) !== major(baseline.lighthouseVersion) || major(prior.lighthouseVersion) !== major(baseline.lighthouseVersion)) return null;
  if (baseline.performance - latest.performance < minPoints || baseline.performance - prior.performance < minPoints) return null;
  return {
    siteId: input.siteId,
    type: "lighthouse_regression",
    entity: input.url,
    window: (prior.checkedAt ?? new Date()).toISOString().slice(0, 10),
    severity: "warning",
    headline: `Mobile performance score for ${input.siteName} fell from ${baseline.performance} to ${latest.performance}`,
    evidence: { url: input.url, before: baseline.performance, previousRun: prior.performance, latestRun: latest.performance, lighthouseVersion: latest.lighthouseVersion },
    cooldownDays: 7,
  };
}

const ORDER: Record<CwvRating, number> = { good: 0, needs_improvement: 1, poor: 2 };
const NAMES: Record<CwvMetric, string> = { lcp: "LCP", inp: "INP", cls: "CLS" };

/** Real-user p75 moving into a worse band than the previous collection period. */
export function cwvDeterioration(input: Base & { periodEnd: string; latest: Record<CwvMetric, number | null>; previous: Record<CwvMetric, number | null> }): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const metric of Object.keys(CWV_THRESHOLDS) as CwvMetric[]) {
    const now = input.latest[metric];
    const before = input.previous[metric];
    if (now === null || before === null) continue;
    const rating = rateCwv(metric, now);
    const was = rateCwv(metric, before);
    if (ORDER[rating] <= ORDER[was]) continue;
    out.push({
      siteId: input.siteId,
      type: "cwv_deterioration",
      entity: metric,
      window: input.periodEnd,
      severity: rating === "poor" ? "critical" : "warning",
      headline: `${NAMES[metric]} for real visitors of ${input.siteName} moved from ${was.replace("_", " ")} to ${rating.replace("_", " ")}`,
      evidence: { metric: NAMES[metric], p75: now, previousP75: before, periodEnd: input.periodEnd, formFactor: "PHONE" },
    });
  }
  return out;
}

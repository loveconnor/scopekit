import "server-only";
import { addDays, eachDay, localDateOf, resolveRange, type ResolvedRange } from "@scopekit/analytics";
import {
  METRIC_DEFINITIONS_VERSION,
  VISITOR_METRIC_MODES,
  type AggregateMeta,
  type AnalyticsFilters,
  type VisitorMetricMode,
} from "@scopekit/contracts";
import {
  dailySeries,
  dailyTotals,
  EMPTY_TOTALS,
  getDb,
  getPreferences,
  getSite,
  listSites,
  rawSeries,
  rawTotals,
  type RawScope,
  type SeriesPoint,
  type SiteDetail,
  type SiteSummary,
  type Totals,
} from "@scopekit/db";
import { notFound } from "next/navigation";
import { cache } from "react";
import { env } from "./env";
import type { ViewState } from "./params";
import { requireUser } from "./session";

/**
 * Wall-clock time for "x minutes ago" labels. Only call it after the request has been
 * authenticated, so it always runs at request time and never during a prerender.
 */
export function requestTime(): number {
  return Date.now();
}

export const loadSites = cache(async (): Promise<SiteSummary[]> => {
  await requireUser();
  return listSites(getDb(), { includeDemo: env.demo });
});

export const loadSite = cache(async (siteId: string): Promise<SiteDetail> => {
  await requireUser();
  const site = await getSite(getDb(), siteId, { includeDemo: env.demo });
  if (!site) notFound();
  return site;
});

export const loadPreferences = cache(async () => {
  const user = await requireUser();
  return getPreferences(getDb(), user.id);
});

/**
 * Default ranges cover complete days only, so a site whose first event arrived today would
 * open on a page of zeros. Until some site has a full day of data, the default is Today
 * instead. A range picked in the URL is always kept.
 */
export function defaultToTodayForNewSites(view: ViewState, sites: { timezone: string; firstEventAt: Date | null }[]): ViewState {
  if (view.range.preset || view.range.from || view.range.to) return view;
  const tracked = sites.filter((s) => s.firstEventAt);
  if (!tracked.length) return view;
  const now = new Date();
  const noCompleteDay = tracked.every((s) => localDateOf(s.firstEventAt!, s.timezone) >= localDateOf(now, s.timezone));
  return noCompleteDay ? { ...view, range: { ...view.range, preset: "today" } } : view;
}

export async function rangeFor(view: ViewState, timeZone: string): Promise<ResolvedRange> {
  const preset = view.range.preset ?? (await loadPreferences()).defaultRange;
  return resolveRange({ preset, from: view.range.from, to: view.range.to, timeZone });
}

export type PointStatus = "measured" | "estimated" | "provisional";
export type ReportPoint = {
  bucket: string;
  pageviews: number;
  sessions: number;
  visitors: number | null;
  events: number;
  /** `provisional` marks the current, unfinished day or hour. */
  status: PointStatus;
};

export type ReportMeta = AggregateMeta & {
  visitorMode: VisitorMetricMode;
  /** The privacy mode changed inside the range, so visitor figures are not comparable across it. */
  mixedVisitorModes: boolean;
  /** Read from raw events (hourly or filtered view) instead of daily rollups. */
  fromRawEvents: boolean;
  /** The range starts before the oldest retained raw event, so a raw view cannot cover all of it. */
  truncatedByRetention: boolean;
};

export type SiteReport = {
  range: ResolvedRange;
  totals: Totals;
  previous: Totals | null;
  series: ReportPoint[];
  meta: ReportMeta;
  /** Engagement and goal figures need whole sessions, so filtered views leave them out. */
  sessionMetricsAvailable: boolean;
};

function fillDays(range: ResolvedRange, points: SeriesPoint[], hasVisitors: boolean, today: string): ReportPoint[] {
  const byDay = new Map(points.map((point) => [point.bucket, point]));
  return eachDay(range.from, range.to).map((day) => {
    const point = byDay.get(day);
    return {
      bucket: day,
      pageviews: point?.pageviews ?? 0,
      sessions: point?.sessions ?? 0,
      visitors: hasVisitors ? (point?.visitors ?? 0) : null,
      events: point?.events ?? 0,
      status: day >= today ? "provisional" : "measured",
    };
  });
}

function fillHours(range: ResolvedRange, points: SeriesPoint[], hasVisitors: boolean, now: number): ReportPoint[] {
  const byHour = new Map(points.map((point) => [Date.parse(point.bucket), point]));
  const out: ReportPoint[] = [];
  for (let t = range.start.getTime(); t < range.end.getTime() && t <= now; t += 3_600_000) {
    const point = byHour.get(t);
    out.push({
      bucket: new Date(t).toISOString(),
      pageviews: point?.pageviews ?? 0,
      sessions: point?.sessions ?? 0,
      visitors: hasVisitors ? (point?.visitors ?? 0) : null,
      events: point?.events ?? 0,
      status: t + 3_600_000 > now ? "provisional" : "measured",
    });
  }
  return out;
}

export function retentionStart(site: SiteDetail, now: Date): string {
  return addDays(localDateOf(now, site.timezone), -site.settings.retentionDays);
}

/**
 * Totals, comparison and time series for one site. Daily rollups by default; raw events
 * when the view is hourly or filtered, with the same per-day definitions either way.
 */
export async function siteReport(site: SiteDetail, view: ViewState, filters?: AnalyticsFilters): Promise<SiteReport> {
  const db = getDb();
  const range = await rangeFor(view, site.timezone);
  const now = new Date();
  const today = localDateOf(now, site.timezone);
  const activeFilters = filters ?? view.filters;
  const hasFilters = Object.keys(activeFilters).length > 0;
  const fromRaw = range.granularity === "hour" || hasFilters;
  const currentMode = VISITOR_METRIC_MODES[site.privacyMode];

  if (fromRaw) {
    const scope: RawScope = { siteId: site.id, start: range.start, end: range.end, timezone: site.timezone, filters: activeFilters };
    const previousScope: RawScope = { ...scope, start: range.previous.start, end: range.previous.end };
    const [totals, previous, points] = await Promise.all([
      rawTotals(db, scope),
      view.compare ? rawTotals(db, previousScope) : null,
      rawSeries(db, scope, range.granularity),
    ]);
    const hasVisitors = currentMode !== "unavailable";
    const strip = (t: Totals): Totals => ({ ...t, visitors: hasVisitors ? t.visitors : null });
    return {
      range,
      totals: strip(totals),
      previous: previous ? strip(previous) : null,
      series:
        range.granularity === "hour"
          ? fillHours(range, points, hasVisitors, now.getTime())
          : fillDays(range, points, hasVisitors, today),
      meta: {
        source: "scopekit",
        freshThrough: totals.freshThrough,
        isPartial: range.includesToday,
        metricDefinitionsVersion: METRIC_DEFINITIONS_VERSION,
        visitorMode: currentMode,
        mixedVisitorModes: false,
        fromRawEvents: true,
        truncatedByRetention: range.from < retentionStart(site, now),
      },
      sessionMetricsAvailable: false,
    };
  }

  const [totals, previous, points] = await Promise.all([
    dailyTotals(db, site.id, range.from, range.to),
    view.compare ? dailyTotals(db, site.id, range.previous.from, range.previous.to) : null,
    dailySeries(db, site.id, range.from, range.to),
  ]);
  const modes = totals.visitorModes as VisitorMetricMode[];
  const visitorMode = modes.length === 1 ? modes[0]! : currentMode;
  const hasVisitors = totals.visitors !== null || (modes.length === 0 && currentMode !== "unavailable");
  return {
    range,
    totals: totals.daysWithData ? totals : { ...EMPTY_TOTALS, visitors: hasVisitors ? 0 : null },
    previous: previous && previous.daysWithData > 0 ? previous : previous ? { ...EMPTY_TOTALS, visitors: null } : null,
    series: fillDays(range, points, hasVisitors, today),
    meta: {
      source: "scopekit",
      freshThrough: totals.freshThrough,
      isPartial: range.includesToday,
      metricDefinitionsVersion: METRIC_DEFINITIONS_VERSION,
      visitorMode,
      mixedVisitorModes: modes.length > 1,
      fromRawEvents: false,
      truncatedByRetention: false,
    },
    sessionMetricsAvailable: true,
  };
}

export type PortfolioSite = {
  site: SiteSummary;
  range: ResolvedRange;
  totals: Totals;
  previous: Totals | null;
  series: { bucket: string; pageviews: number }[];
  hasData: boolean;
};

export type Portfolio = {
  sites: PortfolioSite[];
  /** Label range: the first site's, since sites in different timezones can differ by a day. */
  range: ResolvedRange | null;
  totals: { pageviews: number; summedSiteVisitors: number | null; sessions: number };
  previous: { pageviews: number; summedSiteVisitors: number | null; sessions: number } | null;
  freshThrough: string | null;
  days: string[];
};

/**
 * Cross-site summary. Each site is measured in its own timezone and visitors are summed
 * per site: nothing here deduplicates people across properties.
 */
export async function portfolioReport(view: ViewState): Promise<Portfolio> {
  const db = getDb();
  const sites = await loadSites();
  const preset = view.range.preset ?? (await loadPreferences()).defaultRange;
  // Hourly presets are per-site views; the portfolio always compares whole days.
  const dayPreset = preset === "24h" ? "today" : preset;

  const perSite = await Promise.all(
    sites.map(async (site): Promise<PortfolioSite> => {
      const range = resolveRange({ preset: dayPreset, from: view.range.from, to: view.range.to, timeZone: site.timezone });
      const [totals, previous, series] = await Promise.all([
        dailyTotals(db, site.id, range.from, range.to),
        view.compare ? dailyTotals(db, site.id, range.previous.from, range.previous.to) : null,
        dailySeries(db, site.id, range.from, range.to),
      ]);
      return {
        site,
        range,
        totals,
        previous: previous && previous.daysWithData > 0 ? previous : null,
        series: series.map((point) => ({ bucket: point.bucket, pageviews: point.pageviews })),
        hasData: totals.daysWithData > 0,
      };
    }),
  );

  const sum = (pick: (t: Totals) => number | null, rows: (Totals | null)[]) => {
    let total: number | null = null;
    for (const row of rows) {
      const value = row ? pick(row) : null;
      if (value !== null) total = (total ?? 0) + value;
    }
    return total;
  };
  const current = perSite.map((s) => s.totals);
  const prior = perSite.map((s) => s.previous);
  const anyPrevious = prior.some(Boolean);
  const range = perSite[0]?.range ?? null;
  const freshThrough = perSite.reduce<string | null>((max, s) => {
    const fresh = (s.totals as Totals & { freshThrough?: string | null }).freshThrough ?? null;
    return fresh && (!max || fresh > max) ? fresh : max;
  }, null);

  return {
    sites: perSite,
    range,
    totals: {
      pageviews: sum((t) => t.pageviews, current) ?? 0,
      sessions: sum((t) => t.sessions, current) ?? 0,
      summedSiteVisitors: sum((t) => t.visitors, current),
    },
    previous: anyPrevious
      ? {
          pageviews: sum((t) => t.pageviews, prior) ?? 0,
          sessions: sum((t) => t.sessions, prior) ?? 0,
          summedSiteVisitors: sum((t) => t.visitors, prior),
        }
      : null,
    freshThrough,
    days: range ? eachDay(range.from, range.to) : [],
  };
}

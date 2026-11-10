import "server-only";
import { addDays, eachDay, localDateOf } from "@scopekit/analytics";
import { GSC_MAX_HISTORY_DAYS, GSC_TIMEZONE } from "@scopekit/contracts";
import {
  getDb,
  gscNamedQueryTotals,
  gscPageCounts,
  gscPageTable,
  gscQueryTable,
  gscSeries,
  gscTotals,
  GSC_TABLE_SORTS,
  listPropertiesForSites,
  listSiteProperties,
  openOpportunitySubjects,
  type GscTableRow,
  type GscTableSort,
  type GscTotals,
  type SiteDetail,
  type SiteProperty,
} from "@scopekit/db";
import { backfillProgress, ctrOf, googleConfigFromEnv, loadMasterKey, positionOf, resolveGscRange, type GoogleAccess, type GscRange } from "@scopekit/seo";
import { cache } from "react";
import { parseViewState, type SearchParams, type ViewState } from "./params";
import { loadPreferences, loadSite } from "./reports";
import { requireUser } from "./session";
import { viewParams } from "./view-state";

/** Google OAuth client plus the key that encrypts its tokens. Null until both are in the environment. */
export function searchConsoleAccess(): GoogleAccess | null {
  const google = googleConfigFromEnv();
  const masterKey = loadMasterKey();
  return google && masterKey ? { google, masterKey } : null;
}

/** Hard cap on URL inspections per property and Pacific Time day, far inside Google's own 2,000. */
export const INSPECTION_DAILY_CAP = 200;
export const pacificToday = (now = new Date()) => localDateOf(now, GSC_TIMEZONE);
export const backfillTargetFor = (now = new Date()) => addDays(pacificToday(now), -GSC_MAX_HISTORY_DAYS);

export type SearchConnection = {
  /** `waiting` means a property is linked but its first sync has not stored anything yet. */
  state: "not_configured" | "not_connected" | "waiting" | "ready";
  configured: boolean;
  properties: SiteProperty[];
  active: SiteProperty | null;
  progress: ReturnType<typeof backfillProgress>;
};

function connectionFrom(properties: SiteProperty[], configured: boolean, wanted?: string): SearchConnection {
  const active = properties.find((p) => p.id === wanted) ?? properties.find((p) => p.finalizedThrough) ?? properties[0] ?? null;
  const state = !active ? (configured ? "not_connected" : "not_configured") : active.finalizedThrough ? "ready" : "waiting";
  return { state, configured, properties, active, progress: active ? backfillProgress(active) : null };
}

export const loadSearchConnection = cache(async (siteId: string, wanted?: string): Promise<SearchConnection> => {
  await requireUser();
  return connectionFrom(await listSiteProperties(getDb(), siteId), searchConsoleAccess() !== null, wanted);
});

export type ReadyConnection = SearchConnection & { state: "ready"; active: SiteProperty & { finalizedThrough: string } };
export const isReady = (conn: SearchConnection): conn is ReadyConnection => conn.state === "ready";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Site, URL state and Search Console connection shared by every SEO page. */
export async function loadSeoView(params: Promise<{ siteId: string }>, searchParams: Promise<SearchParams>) {
  const [{ siteId }, raw] = await Promise.all([params, searchParams]);
  const site = await loadSite(siteId);
  const sp = await viewParams(raw);
  const conn = await loadSearchConnection(site.id, one(sp.property));
  const view = parseViewState(sp);
  const range = isReady(conn) ? await searchRange(view, conn.active.finalizedThrough) : null;
  return { site, sp, view, conn, range, base: `/sites/${site.id}` };
}

export async function searchRange(view: ViewState, finalizedThrough: string): Promise<GscRange> {
  const preferences = await loadPreferences();
  return resolveGscRange({
    preset: view.range.preset,
    from: view.range.from,
    to: view.range.to,
    finalizedThrough,
    fallbackPreset: preferences.defaultRange,
  });
}

export type SearchMetric = "clicks" | "impressions" | "ctr" | "position";
export const SEARCH_METRICS: SearchMetric[] = ["clicks", "impressions", "ctr", "position"];

export type SearchPoint = { date: string; clicks: number; impressions: number; ctr: number | null; position: number | null };

export async function searchSummary(propertyId: string, range: GscRange, compare: boolean) {
  const db = getDb();
  const [totals, previous, series, previousSeries] = await Promise.all([
    gscTotals(db, propertyId, range.from, range.to),
    compare ? gscTotals(db, propertyId, range.previous.from, range.previous.to) : null,
    gscSeries(db, propertyId, range.from, range.to),
    compare ? gscSeries(db, propertyId, range.previous.from, range.previous.to) : null,
  ]);
  // Google leaves out days with no impressions, so a missing finalized day is a real zero.
  const fill = (from: string, to: string, rows: typeof series): SearchPoint[] => {
    const byDate = new Map(rows.map((r) => [r.date, r]));
    return eachDay(from, to).map((date) => {
      const row = byDate.get(date);
      return { date, clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, ctr: row ? ctrOf(row) : null, position: row ? positionOf(row) : null };
    });
  };
  return {
    totals,
    // No stored days in the comparison period means there is nothing to compare with.
    previous: previous && previous.days > 0 ? previous : null,
    series: fill(range.from, range.to, series),
    previousSeries: previousSeries ? fill(range.previous.from, range.previous.to, previousSeries) : null,
  };
}

export const metricsOf = (m: Pick<GscTotals, "clicks" | "impressions" | "positionNumerator">) => ({ ctr: ctrOf(m), position: positionOf(m) });

export const SEO_PAGE_SIZE = 50;

export type SearchTableRow = GscTableRow & { pages?: number; hasOpportunity: boolean };

export async function searchTable(
  kind: "query" | "page",
  propertyId: string,
  range: GscRange,
  compare: boolean,
  opts: { search?: string; sort?: string; page?: number; limit?: number },
): Promise<{ rows: SearchTableRow[]; total: number; sort: GscTableSort; page: number; pages: number }> {
  const db = getDb();
  const sort = GSC_TABLE_SORTS.includes(opts.sort as GscTableSort) && (compare || opts.sort !== "change") ? (opts.sort as GscTableSort) : "clicks";
  const limit = opts.limit ?? SEO_PAGE_SIZE;
  const page = Number.isInteger(opts.page) && opts.page! > 0 ? opts.page! : 1;
  const table = await (kind === "query" ? gscQueryTable : gscPageTable)(db, {
    propertyId,
    from: range.from,
    to: range.to,
    previous: compare ? range.previous : null,
    search: opts.search,
    sort,
    limit,
    offset: (page - 1) * limit,
  });
  const keys = table.rows.map((r) => r.key);
  const [flagged, pageCounts] = await Promise.all([
    openOpportunitySubjects(db, propertyId, kind, keys),
    kind === "query" ? gscPageCounts(db, propertyId, keys, range.from, range.to) : null,
  ]);
  return {
    rows: table.rows.map((r) => ({ ...r, hasOpportunity: flagged.has(r.key), ...(pageCounts ? { pages: pageCounts.get(r.key) ?? 0 } : {}) })),
    total: table.total,
    sort,
    page,
    pages: Math.max(1, Math.ceil(table.total / limit)),
  };
}

/** Share of the property's clicks that arrived with a visible query. The rest is withheld by Google. */
export async function queryCoverage(propertyId: string, range: GscRange, totals: GscTotals) {
  const named = await gscNamedQueryTotals(getDb(), propertyId, range.from, range.to);
  return { ...named, clickShare: totals.clicks > 0 ? Math.min(1, named.clicks / totals.clicks) : null };
}

export type PortfolioSearch = {
  /** Site ID to its search clicks, for connected sites only. */
  bySite: Map<string, { clicks: number; previousClicks: number | null; through: string; needsReauth: boolean }>;
  clicks: number | null;
  previousClicks: number | null;
  /** Oldest finalized date among the connected sites: the total is complete through here. */
  through: string | null;
  needsReauth: { siteId: string }[];
};

/** Search clicks per site for the portfolio. Each site uses its own finalized range; sites without a property are left out, not counted as zero. */
export async function portfolioSearch(siteIds: string[], view: ViewState): Promise<PortfolioSearch> {
  const db = getDb();
  const properties = await listPropertiesForSites(db, siteIds);
  const bySite: PortfolioSearch["bySite"] = new Map();
  const needsReauth: { siteId: string }[] = [];
  // One property per site: summing a domain property and a URL-prefix property would count clicks twice.
  const chosen = new Map<string, SiteProperty>();
  for (const property of properties) {
    if (property.connectionStatus === "needs_reauth" && !needsReauth.some((n) => n.siteId === property.siteId)) needsReauth.push({ siteId: property.siteId });
    if (property.finalizedThrough && !chosen.has(property.siteId)) chosen.set(property.siteId, property);
  }
  await Promise.all(
    [...chosen.values()].map(async (property) => {
      const range = await searchRange(view, property.finalizedThrough!);
      const [current, previous] = await Promise.all([
        gscTotals(db, property.id, range.from, range.to),
        view.compare ? gscTotals(db, property.id, range.previous.from, range.previous.to) : null,
      ]);
      bySite.set(property.siteId, {
        clicks: current.clicks,
        previousClicks: previous && previous.days > 0 ? previous.clicks : null,
        through: range.to,
        needsReauth: property.connectionStatus === "needs_reauth",
      });
    }),
  );
  const values = [...bySite.values()];
  return {
    bySite,
    clicks: values.length ? values.reduce((sum, v) => sum + v.clicks, 0) : null,
    previousClicks: values.length && values.every((v) => v.previousClicks !== null) ? values.reduce((sum, v) => sum + (v.previousClicks ?? 0), 0) : null,
    through: values.length ? values.map((v) => v.through).sort()[0]! : null,
    needsReauth,
  };
}

/** Path of a search page URL when it belongs to the site, for linking into ScopeKit analytics. */
export function sitePathOf(site: SiteDetail, pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    return site.hostnames.includes(url.host.toLowerCase()) ? url.pathname.replace(/(.)\/$/, "$1") : null;
  } catch {
    return null;
  }
}

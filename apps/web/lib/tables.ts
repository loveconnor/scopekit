import "server-only";
import type { ResolvedRange } from "@scopekit/analytics";
import type { FilterDimension } from "@scopekit/contracts";
import {
  dimensionTable,
  getDb,
  pageTable,
  rawBreakdown,
  sourceTable,
  type BreakdownRow,
  type PageRow,
  type PageSort,
  type RawScope,
  type SiteDetail,
  type SourceGrouping,
  type SourceRow,
} from "@scopekit/db";
import type { ViewState } from "./params";
import { rangeFor } from "./reports";

const usesRaw = (range: ResolvedRange, view: ViewState) => range.granularity === "hour" || view.hasFilters;
const rawScope = (site: SiteDetail, range: ResolvedRange, view: ViewState): RawScope => ({
  siteId: site.id,
  start: range.start,
  end: range.end,
  timezone: site.timezone,
  filters: view.filters,
});

const PAGE_SORTS: PageSort[] = ["pageviews", "sessions", "visitors", "entries", "exits", "goalCompletions"];
const decodeCursor = (cursor: string | undefined) => {
  const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
};
const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString("base64url");

export type PagesReport = {
  range: ResolvedRange;
  rows: PageRow[];
  total: number | null;
  nextCursor: string | null;
  sort: PageSort;
  /** Entries, exits and goal completions come from rollups only. */
  fromRawEvents: boolean;
};

export async function pagesReport(
  site: SiteDetail,
  view: ViewState,
  opts: { search?: string; sort?: string; cursor?: string; limit?: number } = {},
): Promise<PagesReport> {
  const db = getDb();
  const range = await rangeFor(view, site.timezone);
  const sort = PAGE_SORTS.includes(opts.sort as PageSort) ? (opts.sort as PageSort) : "pageviews";
  const limit = opts.limit ?? 50;

  if (usesRaw(range, view)) {
    const rows = await rawBreakdown(db, rawScope(site, range, view), "page", limit);
    const hasVisitors = site.privacyMode !== "strict";
    return {
      range,
      rows: rows.map((r) => ({
        path: r.key,
        pageviews: r.pageviews,
        sessions: r.sessions,
        visitors: hasVisitors ? r.visitors : null,
        entries: null,
        exits: null,
        goalCompletions: null,
      })),
      total: null,
      nextCursor: null,
      sort: "pageviews",
      fromRawEvents: true,
    };
  }

  const offset = decodeCursor(opts.cursor);
  const result = await pageTable(db, { siteId: site.id, from: range.from, to: range.to, search: opts.search, sort, limit, offset });
  return {
    range,
    rows: result.rows,
    total: result.total,
    nextCursor: offset + result.rows.length < result.total ? encodeCursor(offset + result.rows.length) : null,
    sort,
    fromRawEvents: false,
  };
}

export async function sourcesReport(site: SiteDetail, view: ViewState, groupBy: SourceGrouping) {
  const db = getDb();
  const range = await rangeFor(view, site.timezone);
  let rows: SourceRow[];
  let fromRawEvents = false;
  if (usesRaw(range, view)) {
    fromRawEvents = true;
    const hasVisitors = site.privacyMode !== "strict";
    const raw = await rawBreakdown(db, rawScope(site, range, view), groupBy);
    rows = raw.map((r) => {
      const [key, medium] = groupBy === "source" ? r.key.split("\u001f") : [r.key, null];
      return {
        key: key ?? r.key,
        medium: medium ?? null,
        sessions: r.sessions,
        pageviews: r.pageviews,
        visitors: hasVisitors ? r.visitors : null,
        convertingSessions: null,
      };
    });
    rows.sort((a, b) => b.sessions - a.sessions);
  } else {
    rows = await sourceTable(db, { siteId: site.id, from: range.from, to: range.to, groupBy });
  }
  return { range, rows, fromRawEvents };
}

export async function breakdownReport(
  site: SiteDetail,
  view: ViewState,
  dimension: Extract<FilterDimension, "country" | "device" | "browser">,
  limit = 8,
): Promise<BreakdownRow[]> {
  const db = getDb();
  const range = await rangeFor(view, site.timezone);
  if (usesRaw(range, view)) {
    const rows = await rawBreakdown(db, rawScope(site, range, view), dimension, limit);
    return site.privacyMode === "strict" ? rows.map((r) => ({ ...r, visitors: null })) : rows;
  }
  return dimensionTable(db, { siteId: site.id, from: range.from, to: range.to, dimension, limit });
}

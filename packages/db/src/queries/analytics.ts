import type { AnalyticsFilters, FilterDimension } from "@scopekit/contracts";
import { sql, type SQL } from "drizzle-orm";
import type { Database } from "../client";
import { iso, rows, ts } from "../util";

export type Totals = {
  pageviews: number;
  sessions: number;
  engagedSessions: number;
  /** Daily visitor estimates summed over the range; null when no day in the range has one. */
  visitors: number | null;
  events: number;
  conversions: number;
  convertingSessions: number;
};

export const EMPTY_TOTALS: Totals = {
  pageviews: 0,
  sessions: 0,
  engagedSessions: 0,
  visitors: null,
  events: 0,
  conversions: 0,
  convertingSessions: 0,
};

export type SeriesPoint = { bucket: string; pageviews: number; sessions: number; visitors: number | null; events: number };

/* ----------------------------------------------------------------------------
 * Rollup reads (default path: fast, covers the full reporting history)
 * ------------------------------------------------------------------------- */

export async function dailyTotals(db: Database, siteId: string, from: string, to: string) {
  const [row] = await rows<Totals & { freshThrough: string | null; visitorModes: string[] | null; daysWithData: number }>(
    db,
    sql`select coalesce(sum(pageviews), 0)::int as pageviews,
               coalesce(sum(sessions), 0)::int as sessions,
               coalesce(sum(engaged_sessions), 0)::int as "engagedSessions",
               sum(visitor_estimate)::int as visitors,
               coalesce(sum(event_count), 0)::int as events,
               coalesce(sum(conversions), 0)::int as conversions,
               coalesce(sum(converting_sessions), 0)::int as "convertingSessions",
               ${iso(sql`max(data_watermark)`)} as "freshThrough",
               array_agg(distinct visitor_mode) as "visitorModes",
               count(*)::int as "daysWithData"
        from site_daily_metrics
        where site_id = ${siteId} and local_date between ${from}::date and ${to}::date`,
  );
  return { ...row!, visitorModes: row!.visitorModes ?? [] };
}

export async function dailySeries(db: Database, siteId: string, from: string, to: string): Promise<SeriesPoint[]> {
  return rows<SeriesPoint>(
    db,
    sql`select local_date::text as bucket, pageviews, sessions, visitor_estimate as visitors, event_count as events
        from site_daily_metrics
        where site_id = ${siteId} and local_date between ${from}::date and ${to}::date
        order by local_date`,
  );
}

export type PageRow = {
  path: string;
  pageviews: number;
  sessions: number;
  visitors: number | null;
  entries: number | null;
  exits: number | null;
  goalCompletions: number | null;
};

const PAGE_SORTS = {
  pageviews: sql`2`,
  sessions: sql`3`,
  visitors: sql`4`,
  entries: sql`5`,
  exits: sql`6`,
  goalCompletions: sql`7`,
} as const;
export type PageSort = keyof typeof PAGE_SORTS;

export async function pageTable(
  db: Database,
  opts: { siteId: string; from: string; to: string; search?: string; sort?: PageSort; limit?: number; offset?: number },
): Promise<{ rows: PageRow[]; total: number }> {
  const search = opts.search?.trim() ? sql`and normalized_path ilike ${`%${opts.search.trim().replace(/[%_\\]/g, "\\$&")}%`}` : sql``;
  const where = sql`site_id = ${opts.siteId} and local_date between ${opts.from}::date and ${opts.to}::date ${search}`;
  const [data, [count]] = await Promise.all([
    rows<PageRow>(
      db,
      sql`select normalized_path as path, sum(pageviews)::int as pageviews, sum(sessions)::int as sessions,
                 sum(visitor_estimate)::int as visitors, sum(entries)::int as entries, sum(exits)::int as exits,
                 sum(goal_completions)::int as "goalCompletions"
          from page_daily_metrics where ${where}
          group by 1 order by ${PAGE_SORTS[opts.sort ?? "pageviews"]} desc nulls last, 1
          limit ${Math.min(opts.limit ?? 50, 200)} offset ${opts.offset ?? 0}`,
    ),
    rows<{ total: number }>(db, sql`select count(distinct normalized_path)::int as total from page_daily_metrics where ${where}`),
  ]);
  return { rows: data, total: count?.total ?? 0 };
}

export async function pageSeries(db: Database, siteId: string, path: string, from: string, to: string) {
  return rows<{ bucket: string; pageviews: number }>(
    db,
    sql`select local_date::text as bucket, sum(pageviews)::int as pageviews
        from page_daily_metrics
        where site_id = ${siteId} and normalized_path = ${path} and local_date between ${from}::date and ${to}::date
        group by 1 order by 1`,
  );
}

export type SourceRow = {
  key: string;
  medium: string | null;
  sessions: number;
  pageviews: number;
  visitors: number | null;
  convertingSessions: number | null;
};
export type SourceGrouping = "source" | "referrer" | "campaign";

export async function sourceTable(
  db: Database,
  opts: { siteId: string; from: string; to: string; groupBy: SourceGrouping; limit?: number },
): Promise<SourceRow[]> {
  const range = sql`site_id = ${opts.siteId} and local_date between ${opts.from}::date and ${opts.to}::date`;
  const metrics = sql`sum(sessions)::int as sessions, sum(pageviews)::int as pageviews,
                      sum(visitor_estimate)::int as visitors, sum(converting_sessions)::int as "convertingSessions"`;
  const limit = Math.min(opts.limit ?? 50, 200);
  if (opts.groupBy === "source") {
    return rows<SourceRow>(
      db,
      sql`select source as key, medium, ${metrics} from source_daily_metrics where ${range}
          group by 1, 2 order by sessions desc, 1 limit ${limit}`,
    );
  }
  const column = opts.groupBy === "referrer" ? sql`referrer_domain` : sql`campaign`;
  return rows<SourceRow>(
    db,
    sql`select ${column} as key, null as medium, ${metrics} from source_daily_metrics
        where ${range} and ${column} <> '' group by 1 order by sessions desc, 1 limit ${limit}`,
  );
}

export type BreakdownRow = { key: string; pageviews: number; sessions: number; visitors: number | null };

export async function dimensionTable(
  db: Database,
  opts: { siteId: string; from: string; to: string; dimension: "country" | "device" | "browser"; limit?: number },
): Promise<BreakdownRow[]> {
  return rows<BreakdownRow>(
    db,
    sql`select value as key, sum(pageviews)::int as pageviews, sum(sessions)::int as sessions,
               sum(visitor_estimate)::int as visitors
        from dimension_daily_metrics
        where site_id = ${opts.siteId} and dimension = ${opts.dimension}
          and local_date between ${opts.from}::date and ${opts.to}::date
        group by 1 order by pageviews desc, 1 limit ${Math.min(opts.limit ?? 20, 300)}`,
  );
}

export async function eventTable(db: Database, siteId: string, from: string, to: string) {
  return rows<{ eventName: string; eventCount: number; sessionCount: number }>(
    db,
    sql`select event_name as "eventName", sum(event_count)::int as "eventCount", sum(session_count)::int as "sessionCount"
        from event_daily_metrics
        where site_id = ${siteId} and local_date between ${from}::date and ${to}::date
        group by 1 order by 2 desc, 1 limit 200`,
  );
}

export async function goalTotals(db: Database, siteId: string, from: string, to: string) {
  return rows<{ goalId: string; completions: number; convertingSessions: number }>(
    db,
    sql`select goal_id as "goalId", sum(completions)::int as completions, sum(converting_sessions)::int as "convertingSessions"
        from goal_daily_metrics
        where site_id = ${siteId} and local_date between ${from}::date and ${to}::date
        group by 1`,
  );
}

/* ----------------------------------------------------------------------------
 * Raw-event reads (hourly views and filtered views; bounded by raw retention)
 * ------------------------------------------------------------------------- */

const FILTER_COLUMNS: Record<FilterDimension, SQL> = {
  page: sql`normalized_path`,
  referrer: sql`coalesce(referrer_domain, '')`,
  source: sql`source`,
  medium: sql`medium`,
  campaign: sql`coalesce(campaign, '')`,
  country: sql`coalesce(country_code, 'Unknown')`,
  device: sql`device_type`,
  browser: sql`browser_family`,
};

function filterSql(filters: AnalyticsFilters | undefined): SQL {
  const parts: SQL[] = [];
  for (const [dimension, values] of Object.entries(filters ?? {}) as [FilterDimension, string[]][]) {
    if (!values?.length || !(dimension in FILTER_COLUMNS)) continue;
    parts.push(sql`and ${FILTER_COLUMNS[dimension]} in ${values.slice(0, 20)}`);
  }
  return sql.join(parts, sql` `);
}

export type RawScope = { siteId: string; start: Date; end: Date; timezone: string; filters?: AnalyticsFilters };

const rawWhere = (scope: RawScope) =>
  sql`site_id = ${scope.siteId} and occurred_at >= ${ts(scope.start)} and occurred_at < ${ts(scope.end)}
      and not bot_flag ${filterSql(scope.filters)}`;

const RAW_METRICS = sql`
  count(*) filter (where event_type = 'pageview')::int as pageviews,
  count(distinct session_key) filter (where event_type <> 'engagement')::int as sessions,
  count(distinct visitor_key)::int as visitors,
  count(*) filter (where event_type in ('custom', 'outbound_click', 'download'))::int as events`;

export async function rawSeries(db: Database, scope: RawScope, bucket: "hour" | "day"): Promise<SeriesPoint[]> {
  const expr =
    bucket === "hour"
      ? iso(sql`date_trunc('hour', occurred_at, ${scope.timezone})`)
      : sql`(occurred_at at time zone ${scope.timezone})::date::text`;
  return rows<SeriesPoint>(
    db,
    sql`select ${expr} as bucket, ${RAW_METRICS} from analytics_events where ${rawWhere(scope)} group by 1 order by 1`,
  );
}

/** Same definitions as the rollups: per-local-day figures, summed. */
export async function rawTotals(db: Database, scope: RawScope): Promise<Totals & { freshThrough: string | null }> {
  const [row] = await rows<Totals & { freshThrough: string | null }>(
    db,
    sql`select coalesce(sum(pageviews), 0)::int as pageviews, coalesce(sum(sessions), 0)::int as sessions,
               0 as "engagedSessions", coalesce(sum(visitors), 0)::int as visitors,
               coalesce(sum(events), 0)::int as events, 0 as conversions, 0 as "convertingSessions",
               ${iso(sql`max(fresh)`)} as "freshThrough"
        from (
          select (occurred_at at time zone ${scope.timezone})::date as d, ${RAW_METRICS}, max(received_at) as fresh
          from analytics_events where ${rawWhere(scope)} group by 1
        ) per_day`,
  );
  return row!;
}

const BREAKDOWN_EXPR: Record<FilterDimension, SQL> = {
  ...FILTER_COLUMNS,
  source: sql`source || chr(31) || medium`,
};

export async function rawBreakdown(
  db: Database,
  scope: RawScope,
  dimension: FilterDimension,
  limit = 50,
): Promise<BreakdownRow[]> {
  const skipEmpty = dimension === "referrer" || dimension === "campaign" ? sql`where key <> ''` : sql``;
  return rows<BreakdownRow>(
    db,
    sql`select key, sum(pageviews)::int as pageviews, sum(sessions)::int as sessions, sum(visitors)::int as visitors
        from (
          select ${BREAKDOWN_EXPR[dimension]} as key, (occurred_at at time zone ${scope.timezone})::date as d, ${RAW_METRICS}
          from analytics_events where ${rawWhere(scope)} group by 1, 2
        ) per_day ${skipEmpty}
        group by key order by pageviews desc, sessions desc, key limit ${Math.min(limit, 200)}`,
  );
}

/* ----------------------------------------------------------------------------
 * Realtime and install verification
 * ------------------------------------------------------------------------- */

export type RealtimeSnapshot = {
  activeSessions: number;
  perMinute: { minute: string; events: number }[];
  topPages: { path: string; pageviews: number }[];
  topSources: { source: string; medium: string; sessions: number }[];
  freshThrough: string | null;
};

/** No session identifiers or per-visitor trails leave this function. */
export async function realtimeSnapshot(db: Database, siteId: string): Promise<RealtimeSnapshot> {
  const recent = sql`site_id = ${siteId} and occurred_at >= now() - interval '30 minutes' and not bot_flag`;
  const [[active], perMinute, topPages, topSources] = await Promise.all([
    rows<{ activeSessions: number; freshThrough: string | null }>(
      db,
      sql`select count(distinct session_key) filter (where occurred_at >= now() - interval '5 minutes')::int as "activeSessions",
                 ${iso(sql`max(received_at)`)} as "freshThrough"
          from analytics_events where ${recent}`,
    ),
    rows<{ minute: string; events: number }>(
      db,
      sql`select ${iso(sql`date_trunc('minute', occurred_at)`)} as minute, count(*)::int as events
          from analytics_events where ${recent} and event_type <> 'engagement' group by 1 order by 1`,
    ),
    rows<{ path: string; pageviews: number }>(
      db,
      sql`select normalized_path as path, count(*)::int as pageviews
          from analytics_events where ${recent} and event_type = 'pageview' group by 1 order by 2 desc, 1 limit 8`,
    ),
    rows<{ source: string; medium: string; sessions: number }>(
      db,
      sql`select source, medium, count(distinct session_key)::int as sessions
          from analytics_events where ${recent} and event_type <> 'engagement' group by 1, 2 order by 3 desc, 1 limit 8`,
    ),
  ]);
  return {
    activeSessions: active?.activeSessions ?? 0,
    freshThrough: active?.freshThrough ?? null,
    perMinute,
    topPages,
    topSources,
  };
}

/** Events received recently, bots included, so an install check can explain what it saw. */
export async function recentIngest(db: Database, siteId: string, sinceMinutes = 10) {
  const [row] = await rows<{ events: number; botEvents: number; lastReceivedAt: string | null; lastPath: string | null }>(
    db,
    sql`select count(*) filter (where not bot_flag)::int as events,
               count(*) filter (where bot_flag)::int as "botEvents",
               ${iso(sql`max(received_at)`)} as "lastReceivedAt",
               (array_agg(normalized_path order by received_at desc))[1] as "lastPath"
        from analytics_events
        where site_id = ${siteId} and received_at >= now() - make_interval(mins => ${sinceMinutes})`,
  );
  return row!;
}

/** Distinct property values seen recently for one event, with sensitive keys already removed at ingest. */
export async function eventPropertySample(db: Database, siteId: string, eventName: string) {
  return rows<{ key: string; value: string; count: number }>(
    db,
    sql`select p.key, left(p.value, 80) as value, count(*)::int as count
        from (
          select props from analytics_events
          where site_id = ${siteId} and not bot_flag and occurred_at >= now() - interval '30 days'
            and coalesce(event_name, event_type) = ${eventName} and event_type in ('custom', 'outbound_click', 'download')
          order by occurred_at desc limit 2000
        ) e, jsonb_each_text(e.props) as p(key, value)
        group by 1, 2 order by 1, 3 desc limit 60`,
  );
}

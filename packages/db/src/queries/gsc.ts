import {
  GSC_SEARCH_TYPE,
  type ConnectionStatus,
  type GscPropertyType,
  type OpportunityCategory,
  type OpportunityEvidence,
  type OpportunityRule,
  type OpportunityStatus,
} from "@scopekit/contracts";
import { and, between, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../client";
import {
  gscPageDaily,
  gscQueryDaily,
  gscQueryPageDaily,
  gscSegmentDaily,
  gscSiteDaily,
  gscSyncRuns,
  integrations,
  seoOpportunities,
  siteIntegrations,
  urlInspections,
} from "../schema";
import { chunk, rows } from "../util";

/* ----------------------------------------------------------------------------
 * Connections
 * ------------------------------------------------------------------------- */

export type Integration = typeof integrations.$inferSelect;
export type SiteProperty = typeof siteIntegrations.$inferSelect & {
  accountLabel: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  isDemo: boolean;
};

export async function createIntegration(
  db: Database,
  input: Pick<typeof integrations.$inferInsert, "ownerUserId" | "accountLabel" | "encryptedAccessToken" | "encryptedRefreshToken" | "scope" | "expiresAt" | "isDemo">,
): Promise<string> {
  const [row] = await db
    .insert(integrations)
    .values({ ...input, provider: "google" })
    .returning({ id: integrations.id });
  return row!.id;
}

export async function getIntegration(db: Database, id: string): Promise<Integration | null> {
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
  return row ?? null;
}

export async function listUserIntegrations(db: Database, userId: string): Promise<Integration[]> {
  return db
    .select()
    .from(integrations)
    .where(and(eq(integrations.ownerUserId, userId), eq(integrations.isDemo, false)))
    .orderBy(integrations.createdAt);
}

/** Stores fresh tokens. Passing a refresh token also clears a reauthorization state. */
export async function saveIntegrationTokens(
  db: Database,
  id: string,
  tokens: { encryptedAccessToken: string; expiresAt: Date; encryptedRefreshToken?: string; scope?: string; accountLabel?: string },
): Promise<void> {
  await db
    .update(integrations)
    .set({
      encryptedAccessToken: tokens.encryptedAccessToken,
      expiresAt: tokens.expiresAt,
      ...(tokens.encryptedRefreshToken
        ? { encryptedRefreshToken: tokens.encryptedRefreshToken, connectionStatus: "connected" as const, lastError: null }
        : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      ...(tokens.accountLabel ? { accountLabel: tokens.accountLabel } : {}),
    })
    .where(eq(integrations.id, id));
}

/** History already synced stays in place; only new syncs stop until the owner reconnects. */
export async function markIntegrationNeedsReauth(db: Database, id: string, error: string): Promise<void> {
  await db
    .update(integrations)
    .set({ connectionStatus: "needs_reauth", lastError: error.slice(0, 300), encryptedAccessToken: null, expiresAt: null })
    .where(eq(integrations.id, id));
}

export async function deleteIntegration(db: Database, id: string): Promise<void> {
  await db.delete(integrations).where(eq(integrations.id, id));
}

/** Accounts no site uses any more: abandoned connection attempts, or left behind by a deleted site. */
export async function listUnusedIntegrations(db: Database, olderThanMinutes: number): Promise<Integration[]> {
  return db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.isDemo, false),
        sql`${integrations.createdAt} < now() - make_interval(mins => ${olderThanMinutes})`,
        sql`not exists (select 1 from ${siteIntegrations} p where p.integration_id = "integrations"."id")`,
      ),
    );
}

const propertySelection = {
  property: siteIntegrations,
  accountLabel: integrations.accountLabel,
  connectionStatus: integrations.connectionStatus,
  connectionError: integrations.lastError,
  isDemo: integrations.isDemo,
};
const toProperty = (r: {
  property: typeof siteIntegrations.$inferSelect;
  accountLabel: string;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  isDemo: boolean;
}): SiteProperty => ({ ...r.property, accountLabel: r.accountLabel, connectionStatus: r.connectionStatus, connectionError: r.connectionError, isDemo: r.isDemo });

export async function listSiteProperties(db: Database, siteId: string): Promise<SiteProperty[]> {
  const result = await db
    .select(propertySelection)
    .from(siteIntegrations)
    .innerJoin(integrations, eq(integrations.id, siteIntegrations.integrationId))
    .where(eq(siteIntegrations.siteId, siteId))
    .orderBy(siteIntegrations.createdAt);
  return result.map(toProperty);
}

export async function listPropertiesForSites(db: Database, siteIds: string[]): Promise<SiteProperty[]> {
  if (!siteIds.length) return [];
  const result = await db
    .select(propertySelection)
    .from(siteIntegrations)
    .innerJoin(integrations, eq(integrations.id, siteIntegrations.integrationId))
    .where(inArray(siteIntegrations.siteId, siteIds))
    .orderBy(siteIntegrations.createdAt);
  return result.map(toProperty);
}

export async function getProperty(db: Database, propertyId: string): Promise<SiteProperty | null> {
  if (!/^[0-9a-f-]{36}$/i.test(propertyId)) return null;
  const [row] = await db
    .select(propertySelection)
    .from(siteIntegrations)
    .innerJoin(integrations, eq(integrations.id, siteIntegrations.integrationId))
    .where(eq(siteIntegrations.id, propertyId));
  return row ? toProperty(row) : null;
}

export class PropertyAlreadyLinkedError extends Error {}

export async function linkProperty(
  db: Database,
  input: {
    siteId: string;
    integrationId: string;
    externalPropertyId: string;
    externalPropertyType: GscPropertyType;
    permissionLevel: string | null;
    backfillTarget: string | null;
    /** Demo properties are never synced. */
    schedule?: boolean;
  },
): Promise<string> {
  const [row] = await db
    .insert(siteIntegrations)
    .values({
      siteId: input.siteId,
      integrationId: input.integrationId,
      externalPropertyId: input.externalPropertyId,
      externalPropertyType: input.externalPropertyType,
      permissionLevel: input.permissionLevel,
      backfillTarget: input.backfillTarget,
      nextSyncAt: input.schedule === false ? null : new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: siteIntegrations.id });
  if (!row) throw new PropertyAlreadyLinkedError();
  return row.id;
}

/** Removes the link and every stored row for it. Returns how many links the account has left. */
export async function unlinkProperty(db: Database, siteId: string, propertyId: string): Promise<{ integrationId: string; remaining: number } | null> {
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(siteIntegrations)
      .where(and(eq(siteIntegrations.id, propertyId), eq(siteIntegrations.siteId, siteId)))
      .returning({ integrationId: siteIntegrations.integrationId });
    if (!gone) return null;
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(siteIntegrations)
      .where(eq(siteIntegrations.integrationId, gone.integrationId));
    return { integrationId: gone.integrationId, remaining: left?.n ?? 0 };
  });
}

export async function requestPropertySync(db: Database, propertyId: string): Promise<void> {
  await db.update(siteIntegrations).set({ nextSyncAt: new Date() }).where(eq(siteIntegrations.id, propertyId));
}

/** After a reconnect, every property on the account syncs again straight away. */
export async function requestIntegrationSync(db: Database, integrationId: string): Promise<void> {
  await db
    .update(siteIntegrations)
    .set({ nextSyncAt: new Date(), failureStreak: 0, lastError: null, syncStatus: "idle" })
    .where(eq(siteIntegrations.integrationId, integrationId));
}

export async function updateProperty(
  db: Database,
  propertyId: string,
  patch: Partial<
    Pick<
      typeof siteIntegrations.$inferInsert,
      "oldestSyncedDate" | "finalizedThrough" | "backfillTarget" | "syncStatus" | "nextSyncAt" | "failureStreak" | "lastSyncAt" | "lastError" | "syncHeartbeatAt"
    >
  >,
): Promise<void> {
  await db.update(siteIntegrations).set(patch).where(eq(siteIntegrations.id, propertyId));
}

/**
 * Hands out the properties that are due, marking each as syncing so a second worker (or the
 * next tick) leaves it alone. A sync that stopped reporting for `staleMinutes` can be reclaimed.
 */
export async function claimDueProperties(db: Database, staleMinutes = 15, limit = 20): Promise<string[]> {
  const claimed = await rows<{ id: string }>(
    db,
    sql`update site_integrations p set sync_status = 'syncing', sync_heartbeat_at = now()
        where p.id in (
          select p2.id from site_integrations p2
          join integrations i on i.id = p2.integration_id
          join sites s on s.id = p2.site_id
          where p2.enabled and p2.next_sync_at is not null and p2.next_sync_at <= now()
            and i.connection_status = 'connected' and not i.is_demo and i.encrypted_refresh_token is not null
            and s.deleted_at is null
            and (p2.sync_status <> 'syncing' or p2.sync_heartbeat_at is null or p2.sync_heartbeat_at < now() - make_interval(mins => ${staleMinutes}))
          order by p2.next_sync_at
          limit ${limit}
          for update of p2 skip locked
        )
        returning p.id`,
  );
  return claimed.map((r) => r.id);
}

/* ----------------------------------------------------------------------------
 * Sync writes. A day is always replaced whole, so a retry or a recheck of a late
 * adjustment can never add to what is already stored.
 * ------------------------------------------------------------------------- */

export type GscScope = { propertyId: string; siteId: string; from: string; to: string };
export type GscMetricValues = { clicks: number; impressions: number; positionNumerator: number };

const scopeSql = (propertyId: string, from: string, to: string) =>
  sql`property_id = ${propertyId} and search_type = ${GSC_SEARCH_TYPE} and date between ${from}::date and ${to}::date`;

const base = (scope: GscScope, date: string) => ({ propertyId: scope.propertyId, siteId: scope.siteId, searchType: GSC_SEARCH_TYPE, date });

export async function replaceGscSiteDaily(db: Database, scope: GscScope, values: (GscMetricValues & { date: string })[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(gscSiteDaily)
      .where(and(eq(gscSiteDaily.propertyId, scope.propertyId), eq(gscSiteDaily.searchType, GSC_SEARCH_TYPE), between(gscSiteDaily.date, scope.from, scope.to)));
    for (const part of chunk(values, 2000)) {
      await tx
        .insert(gscSiteDaily)
        .values(part.map((v) => ({ ...base(scope, v.date), aggregationType: "byProperty", clicks: v.clicks, impressions: v.impressions, positionNumerator: v.positionNumerator })))
        .onConflictDoNothing();
    }
  });
}

export async function replaceGscSegments(
  db: Database,
  scope: GscScope,
  dimension: "device" | "country",
  values: (GscMetricValues & { date: string; value: string })[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(gscSegmentDaily)
      .where(
        and(
          eq(gscSegmentDaily.propertyId, scope.propertyId),
          eq(gscSegmentDaily.searchType, GSC_SEARCH_TYPE),
          eq(gscSegmentDaily.dimension, dimension),
          between(gscSegmentDaily.date, scope.from, scope.to),
        ),
      );
    for (const part of chunk(values, 2000)) {
      await tx
        .insert(gscSegmentDaily)
        .values(part.map((v) => ({ ...base(scope, v.date), dimension, value: v.value, clicks: v.clicks, impressions: v.impressions, positionNumerator: v.positionNumerator })))
        .onConflictDoNothing();
    }
  });
}

export type GscDetailRows = {
  queries: (GscMetricValues & { date: string; query: string })[];
  pages: (GscMetricValues & { date: string; pageUrl: string })[];
  queryPages: (GscMetricValues & { date: string; query: string; pageUrl: string })[];
};

/** Query, page and query-page rows for a span of days, swapped in together. */
export async function replaceGscDetail(db: Database, scope: GscScope, detail: GscDetailRows): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [sql`gsc_query_daily`, sql`gsc_page_daily`, sql`gsc_query_page_daily`]) {
      await tx.execute(sql`delete from ${table} where ${scopeSql(scope.propertyId, scope.from, scope.to)}`);
    }
    const metrics = (v: GscMetricValues) => ({ clicks: v.clicks, impressions: v.impressions, positionNumerator: v.positionNumerator });
    for (const part of chunk(detail.queries, 2000)) {
      await tx.insert(gscQueryDaily).values(part.map((v) => ({ ...base(scope, v.date), query: v.query, ...metrics(v) }))).onConflictDoNothing();
    }
    for (const part of chunk(detail.pages, 2000)) {
      await tx.insert(gscPageDaily).values(part.map((v) => ({ ...base(scope, v.date), pageUrl: v.pageUrl, ...metrics(v) }))).onConflictDoNothing();
    }
    for (const part of chunk(detail.queryPages, 2000)) {
      await tx.insert(gscQueryPageDaily).values(part.map((v) => ({ ...base(scope, v.date), query: v.query, pageUrl: v.pageUrl, ...metrics(v) }))).onConflictDoNothing();
    }
  });
}

/** Days Google reported any impressions for. Detail is only requested for these. */
export async function gscDatesWithData(db: Database, propertyId: string, from: string, to: string): Promise<string[]> {
  const result = await db
    .select({ date: gscSiteDaily.date })
    .from(gscSiteDaily)
    .where(and(eq(gscSiteDaily.propertyId, propertyId), eq(gscSiteDaily.searchType, GSC_SEARCH_TYPE), between(gscSiteDaily.date, from, to)))
    .orderBy(gscSiteDaily.date);
  return result.map((r) => r.date);
}

export async function startGscSyncRun(
  db: Database,
  input: { siteId: string; propertyId: string; profile: "first" | "incremental" | "backfill" },
): Promise<string> {
  const [row] = await db
    .insert(gscSyncRuns)
    .values({ ...input, status: "running" })
    .returning({ id: gscSyncRuns.id });
  return row!.id;
}

export async function finishGscSyncRun(
  db: Database,
  id: string,
  outcome: Pick<typeof gscSyncRuns.$inferInsert, "status" | "fromDate" | "toDate" | "rowCount" | "requestCount" | "truncated" | "quotaLimited" | "error">,
): Promise<void> {
  await db
    .update(gscSyncRuns)
    .set({ ...outcome, error: outcome.error?.slice(0, 300), completedAt: new Date() })
    .where(eq(gscSyncRuns.id, id));
}

export async function listGscSyncRuns(db: Database, siteId: string, limit = 10) {
  return db.select().from(gscSyncRuns).where(eq(gscSyncRuns.siteId, siteId)).orderBy(desc(gscSyncRuns.startedAt)).limit(limit);
}

export async function pruneGscSyncRuns(db: Database): Promise<void> {
  await db.execute(sql`delete from gsc_sync_runs where started_at < now() - interval '90 days'`);
}

/* ----------------------------------------------------------------------------
 * Reports. Everything here reads stored rows; a dashboard request never calls Google.
 * ------------------------------------------------------------------------- */

export type GscTotals = GscMetricValues & { days: number };
export type GscSeriesPoint = GscMetricValues & { date: string };

export async function gscTotals(db: Database, propertyId: string, from: string, to: string): Promise<GscTotals> {
  const [row] = await rows<GscTotals>(
    db,
    sql`select coalesce(sum(clicks), 0)::int as clicks, coalesce(sum(impressions), 0)::int as impressions,
               coalesce(sum(position_numerator), 0)::float8 as "positionNumerator", count(*)::int as days
        from gsc_site_daily where ${scopeSql(propertyId, from, to)} and aggregation_type = 'byProperty'`,
  );
  return row ?? { clicks: 0, impressions: 0, positionNumerator: 0, days: 0 };
}

export async function gscSeries(db: Database, propertyId: string, from: string, to: string): Promise<GscSeriesPoint[]> {
  return rows<GscSeriesPoint>(
    db,
    sql`select date::text as date, clicks, impressions, position_numerator::float8 as "positionNumerator"
        from gsc_site_daily where ${scopeSql(propertyId, from, to)} and aggregation_type = 'byProperty' order by date`,
  );
}

export type GscSegmentRow = GscMetricValues & { value: string };

export async function gscSegments(db: Database, propertyId: string, from: string, to: string, dimension: "device" | "country", limit = 8): Promise<GscSegmentRow[]> {
  return rows<GscSegmentRow>(
    db,
    sql`select value, sum(clicks)::int as clicks, sum(impressions)::int as impressions, sum(position_numerator)::float8 as "positionNumerator"
        from gsc_segment_daily where ${scopeSql(propertyId, from, to)} and dimension = ${dimension}
        group by value order by clicks desc, impressions desc, value limit ${limit}`,
  );
}

export type GscTableSort = "clicks" | "impressions" | "ctr" | "position" | "change";
export const GSC_TABLE_SORTS: GscTableSort[] = ["clicks", "impressions", "ctr", "position", "change"];
export type GscTableRow = GscMetricValues & {
  key: string;
  /** Null when the row has no data in the comparison period. */
  previous: GscMetricValues | null;
};

const ORDER: Record<GscTableSort, SQL> = {
  clicks: sql`cur.clicks desc, cur.impressions desc`,
  impressions: sql`cur.impressions desc, cur.clicks desc`,
  ctr: sql`(cur.clicks::float8 / nullif(cur.impressions, 0)) desc nulls last, cur.impressions desc`,
  // Position 1 is the top of the page, so the best rows come first.
  position: sql`(cur.pos / nullif(cur.impressions, 0)) asc nulls last, cur.impressions desc`,
  change: sql`(cur.clicks - coalesce(prev.clicks, 0)) asc, cur.impressions desc`,
};

type TableOptions = {
  propertyId: string;
  from: string;
  to: string;
  previous: { from: string; to: string } | null;
  search?: string;
  sort: GscTableSort;
  limit: number;
  offset: number;
};

async function gscTable(db: Database, kind: "query" | "page", o: TableOptions): Promise<{ rows: GscTableRow[]; total: number }> {
  const table = kind === "query" ? sql`gsc_query_daily` : sql`gsc_page_daily`;
  const column = kind === "query" ? sql`query` : sql`page_url`;
  const search = o.search?.trim();
  const match = search ? sql`and ${column} ilike ${`%${search.replace(/[\\%_]/g, "\\$&")}%`}` : sql``;
  const previous = o.previous ?? { from: o.from, to: o.from };
  const result = await rows<{
    key: string;
    clicks: number;
    impressions: number;
    pos: number;
    prev_clicks: number | null;
    prev_impressions: number | null;
    prev_pos: number | null;
    total: number;
  }>(
    db,
    sql`with cur as (
          select ${column} as key, sum(clicks)::int as clicks, sum(impressions)::int as impressions, sum(position_numerator)::float8 as pos
          from ${table} where ${scopeSql(o.propertyId, o.from, o.to)} ${match} group by ${column}
        ), prev as (
          select ${column} as key, sum(clicks)::int as clicks, sum(impressions)::int as impressions, sum(position_numerator)::float8 as pos
          from ${table} where ${scopeSql(o.propertyId, previous.from, previous.to)} and ${o.previous !== null}::boolean group by ${column}
        )
        select cur.key, cur.clicks, cur.impressions, cur.pos, prev.clicks as prev_clicks, prev.impressions as prev_impressions, prev.pos as prev_pos,
               count(*) over ()::int as total
        from cur left join prev on prev.key = cur.key
        order by ${ORDER[o.sort]}, cur.key
        limit ${o.limit} offset ${o.offset}`,
  );
  return {
    total: result[0]?.total ?? 0,
    rows: result.map((r) => ({
      key: r.key,
      clicks: r.clicks,
      impressions: r.impressions,
      positionNumerator: r.pos,
      previous: r.prev_impressions === null ? null : { clicks: r.prev_clicks ?? 0, impressions: r.prev_impressions, positionNumerator: r.prev_pos ?? 0 },
    })),
  };
}

export const gscQueryTable = (db: Database, o: TableOptions) => gscTable(db, "query", o);
export const gscPageTable = (db: Database, o: TableOptions) => gscTable(db, "page", o);

/** Totals for one query or one page, from its own rows. */
export async function gscSubjectTotals(db: Database, kind: "query" | "page", propertyId: string, subject: string, from: string, to: string): Promise<GscTotals> {
  const table = kind === "query" ? sql`gsc_query_daily` : sql`gsc_page_daily`;
  const column = kind === "query" ? sql`query` : sql`page_url`;
  const [row] = await rows<GscTotals>(
    db,
    sql`select coalesce(sum(clicks), 0)::int as clicks, coalesce(sum(impressions), 0)::int as impressions,
               coalesce(sum(position_numerator), 0)::float8 as "positionNumerator", count(*)::int as days
        from ${table} where ${scopeSql(propertyId, from, to)} and ${column} = ${subject}`,
  );
  return row ?? { clicks: 0, impressions: 0, positionNumerator: 0, days: 0 };
}

export type GscPairRow = GscMetricValues & { key: string };

/** Pages a query led to, or queries a page appeared for, from the capped query-page detail. */
export async function gscPairs(
  db: Database,
  by: "query" | "page",
  propertyId: string,
  subject: string,
  from: string,
  to: string,
  limit = 25,
): Promise<GscPairRow[]> {
  const fixed = by === "query" ? sql`query` : sql`page_url`;
  const other = by === "query" ? sql`page_url` : sql`query`;
  return rows<GscPairRow>(
    db,
    sql`select ${other} as key, sum(clicks)::int as clicks, sum(impressions)::int as impressions, sum(position_numerator)::float8 as "positionNumerator"
        from gsc_query_page_daily where ${scopeSql(propertyId, from, to)} and ${fixed} = ${subject}
        group by ${other} order by clicks desc, impressions desc, ${other} limit ${limit}`,
  );
}

/** How many pages each of these queries led to in the range. */
export async function gscPageCounts(db: Database, propertyId: string, queries: string[], from: string, to: string): Promise<Map<string, number>> {
  if (!queries.length) return new Map();
  const result = await db
    .select({ query: gscQueryPageDaily.query, pages: sql<number>`count(distinct ${gscQueryPageDaily.pageUrl})::int` })
    .from(gscQueryPageDaily)
    .where(
      and(
        eq(gscQueryPageDaily.propertyId, propertyId),
        eq(gscQueryPageDaily.searchType, GSC_SEARCH_TYPE),
        between(gscQueryPageDaily.date, from, to),
        inArray(gscQueryPageDaily.query, queries),
      ),
    )
    .groupBy(gscQueryPageDaily.query);
  return new Map(result.map((r) => [r.query, r.pages]));
}

/**
 * Clicks and impressions that arrived with a visible query. The gap to the property total is
 * what Google withholds (anonymized queries) or cuts off (row limits); it is reported, never filled in.
 */
export async function gscNamedQueryTotals(db: Database, propertyId: string, from: string, to: string): Promise<{ clicks: number; impressions: number; queries: number }> {
  const [row] = await rows<{ clicks: number; impressions: number; queries: number }>(
    db,
    sql`select coalesce(sum(clicks), 0)::int as clicks, coalesce(sum(impressions), 0)::int as impressions, count(distinct query)::int as queries
        from gsc_query_daily where ${scopeSql(propertyId, from, to)}`,
  );
  return row ?? { clicks: 0, impressions: 0, queries: 0 };
}

/* ----------------------------------------------------------------------------
 * Opportunities
 * ------------------------------------------------------------------------- */

export type OpportunityQueryInput = GscMetricValues & { query: string; weeksWithImpressions: number; topPage: string | null; topPageShare: number | null };
export type OpportunityPageInput = { pageUrl: string; clicks: number; impressions: number; previousClicks: number; previousImpressions: number; firstSeen: string };

export async function gscOpportunityInputs(
  db: Database,
  propertyId: string,
  window: { from: string; to: string },
  previous: { from: string; to: string },
): Promise<{ queries: OpportunityQueryInput[]; pages: OpportunityPageInput[] }> {
  const [queries, pages] = await Promise.all([
    rows<OpportunityQueryInput>(
      db,
      sql`with q as (
            select query, sum(clicks)::int as clicks, sum(impressions)::int as impressions, sum(position_numerator)::float8 as pos,
                   count(distinct (date - ${window.from}::date) / 7)::int as weeks
            from gsc_query_daily where ${scopeSql(propertyId, window.from, window.to)}
            group by query having sum(impressions) >= 20
            order by sum(impressions) desc limit 5000
          ), pairs as (
            select query, page_url, sum(impressions)::float8 as impressions, sum(sum(impressions)) over (partition by query)::float8 as total
            from gsc_query_page_daily where ${scopeSql(propertyId, window.from, window.to)} group by query, page_url
          ), top as (
            select distinct on (query) query, page_url, impressions / nullif(total, 0) as share from pairs order by query, impressions desc, page_url
          )
          select q.query, q.clicks, q.impressions, q.pos as "positionNumerator", q.weeks as "weeksWithImpressions",
                 top.page_url as "topPage", top.share as "topPageShare"
          from q left join top on top.query = q.query`,
    ),
    rows<OpportunityPageInput>(
      db,
      sql`select page_url as "pageUrl",
                 coalesce(sum(clicks) filter (where date >= ${window.from}::date), 0)::int as clicks,
                 coalesce(sum(impressions) filter (where date >= ${window.from}::date), 0)::int as impressions,
                 coalesce(sum(clicks) filter (where date <= ${previous.to}::date), 0)::int as "previousClicks",
                 coalesce(sum(impressions) filter (where date <= ${previous.to}::date), 0)::int as "previousImpressions",
                 min(date)::text as "firstSeen"
          from gsc_page_daily where ${scopeSql(propertyId, previous.from, window.to)}
          group by page_url`,
    ),
  ]);
  return { queries, pages };
}

export type DetectedOpportunity = {
  rule: OpportunityRule;
  category: OpportunityCategory;
  subjectType: "query" | "page";
  subject: string;
  score: number;
  evidence: OpportunityEvidence;
};

/**
 * Stores what the rules found. A dismissed item stays dismissed, an item being worked on
 * is marked resolved once it is no longer detected, and untouched items that stop being
 * detected are simply removed.
 */
export async function saveOpportunities(db: Database, scope: { propertyId: string; siteId: string }, detected: DetectedOpportunity[]): Promise<void> {
  await db.transaction(async (tx) => {
    const seenAt = new Date();
    for (const part of chunk(detected, 500)) {
      await tx
        .insert(seoOpportunities)
        .values(part.map((d) => ({ ...scope, ...d, lastSeenAt: seenAt })))
        .onConflictDoUpdate({
          target: [seoOpportunities.propertyId, seoOpportunities.rule, seoOpportunities.subject],
          set: {
            score: sql`excluded.score`,
            evidence: sql`excluded.evidence`,
            category: sql`excluded.category`,
            lastSeenAt: seenAt,
            // Something that was resolved and is detected again is new work.
            status: sql`case when ${seoOpportunities.status} = 'resolved' then 'new' else ${seoOpportunities.status} end`,
          },
        });
    }
    const stale = and(eq(seoOpportunities.propertyId, scope.propertyId), sql`${seoOpportunities.lastSeenAt} < ${seenAt.toISOString()}::timestamptz`);
    await tx.delete(seoOpportunities).where(and(stale, eq(seoOpportunities.status, "new")));
    await tx
      .update(seoOpportunities)
      .set({ status: "resolved", updatedAt: seenAt })
      .where(and(stale, eq(seoOpportunities.status, "in_progress")));
  });
}

export type Opportunity = typeof seoOpportunities.$inferSelect;

export async function listOpportunities(
  db: Database,
  propertyId: string,
  filter: { statuses?: OpportunityStatus[]; category?: OpportunityCategory } = {},
): Promise<Opportunity[]> {
  return db
    .select()
    .from(seoOpportunities)
    .where(
      and(
        eq(seoOpportunities.propertyId, propertyId),
        filter.statuses?.length ? inArray(seoOpportunities.status, filter.statuses) : undefined,
        filter.category ? eq(seoOpportunities.category, filter.category) : undefined,
      ),
    )
    .orderBy(desc(seoOpportunities.score), seoOpportunities.subject)
    .limit(200);
}

export async function countOpportunities(db: Database, propertyId: string): Promise<Record<OpportunityStatus, number>> {
  const result = await db
    .select({ status: seoOpportunities.status, n: sql<number>`count(*)::int` })
    .from(seoOpportunities)
    .where(eq(seoOpportunities.propertyId, propertyId))
    .groupBy(seoOpportunities.status);
  const counts: Record<OpportunityStatus, number> = { new: 0, in_progress: 0, dismissed: 0, resolved: 0 };
  for (const r of result) counts[r.status] = r.n;
  return counts;
}

/** Subjects with open work, for flagging rows in the query and page tables. */
export async function openOpportunitySubjects(db: Database, propertyId: string, subjectType: "query" | "page", subjects: string[]): Promise<Set<string>> {
  if (!subjects.length) return new Set();
  const result = await db
    .select({ subject: seoOpportunities.subject })
    .from(seoOpportunities)
    .where(
      and(
        eq(seoOpportunities.propertyId, propertyId),
        eq(seoOpportunities.subjectType, subjectType),
        inArray(seoOpportunities.status, ["new", "in_progress"]),
        inArray(seoOpportunities.subject, subjects),
      ),
    );
  return new Set(result.map((r) => r.subject));
}

export async function setOpportunityStatus(db: Database, siteId: string, id: string, status: OpportunityStatus): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const result = await db
    .update(seoOpportunities)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(seoOpportunities.id, id), eq(seoOpportunities.siteId, siteId)))
    .returning({ id: seoOpportunities.id });
  return result.length > 0;
}

/* ----------------------------------------------------------------------------
 * URL inspection
 * ------------------------------------------------------------------------- */

export type UrlInspection = typeof urlInspections.$inferSelect;

export async function insertInspection(db: Database, input: typeof urlInspections.$inferInsert): Promise<UrlInspection> {
  const [row] = await db.insert(urlInspections).values(input).returning();
  return row!;
}

/** Newest check per URL, with the verdict of the check before it for spotting a change. */
export async function latestInspections(db: Database, propertyId: string, limit = 100): Promise<(Omit<UrlInspection, "raw"> & { previousVerdict: string | null; checks: number })[]> {
  const result = await rows<Record<string, unknown>>(
    db,
    sql`select * from (
          select distinct on (url) id, site_id, property_id, url, checked_at, index_verdict, coverage_state, crawled_as, google_canonical,
                 user_canonical, last_crawl_at, robots_txt_state, indexing_state, page_fetch_state, inspection_link,
                 lead(index_verdict) over (partition by url order by checked_at desc) as previous_verdict,
                 count(*) over (partition by url)::int as checks
          from url_inspections where property_id = ${propertyId}
          order by url, checked_at desc
        ) latest order by checked_at desc limit ${limit}`,
  );
  const date = (value: unknown) => (value ? new Date(value as string) : null);
  return result.map((r) => ({
    id: r.id as string,
    siteId: r.site_id as string,
    propertyId: r.property_id as string,
    url: r.url as string,
    checkedAt: date(r.checked_at)!,
    indexVerdict: r.index_verdict as string | null,
    coverageState: r.coverage_state as string | null,
    crawledAs: r.crawled_as as string | null,
    googleCanonical: r.google_canonical as string | null,
    userCanonical: r.user_canonical as string | null,
    lastCrawlAt: date(r.last_crawl_at),
    robotsTxtState: r.robots_txt_state as string | null,
    indexingState: r.indexing_state as string | null,
    pageFetchState: r.page_fetch_state as string | null,
    inspectionLink: r.inspection_link as string | null,
    previousVerdict: r.previous_verdict as string | null,
    checks: r.checks as number,
  }));
}

/** Checks made for a property since a moment, to stay inside Google's daily quota. */
export async function countInspectionsSince(db: Database, propertyId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(urlInspections)
    .where(and(eq(urlInspections.propertyId, propertyId), sql`${urlInspections.checkedAt} >= ${since.toISOString()}::timestamptz`));
  return row?.n ?? 0;
}

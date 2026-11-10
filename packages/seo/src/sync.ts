import { addDays, daysInclusive, localDateOf } from "@scopekit/analytics";
import { GSC_MAX_HISTORY_DAYS, GSC_SEARCH_TYPE, GSC_TIMEZONE } from "@scopekit/contracts";
import {
  finishGscSyncRun,
  getIntegration,
  getProperty,
  gscDatesWithData,
  gscOpportunityInputs,
  markIntegrationNeedsReauth,
  replaceGscDetail,
  replaceGscSegments,
  replaceGscSiteDaily,
  saveOpportunities,
  startGscSyncRun,
  updateProperty,
  type Database,
  type GscDetailRows,
  type SiteProperty,
} from "@scopekit/db";
import {
  GoogleAuthError,
  GooglePermissionError,
  GoogleRateLimitError,
  querySearchAnalytics,
  type SearchAnalyticsRequest,
  type SearchAnalyticsRow,
} from "./google";
import { toStored } from "./metrics";
import { detectOpportunities, OPPORTUNITY_THRESHOLDS } from "./opportunities";
import { getAccessToken, type GoogleAccess } from "./tokens";

export type SyncOptions = GoogleAccess & {
  now?: Date;
  /** A run stops after this long and is picked up again, so one large backfill cannot starve other properties. */
  maxRunMs?: number;
  requestDelayMs?: number;
  /** Days of query and page detail fetched per checkpoint. */
  chunkDays?: number;
  /** Row cap per day for queries and for pages. Google itself stops at about 50,000 per day and search type. */
  dayRowCap?: number;
  /** Row cap per day for query-page pairs, which exist for drill-down only. */
  pairRowCap?: number;
  syncIntervalHours?: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
};

export type SyncResult = {
  status: "done" | "partial" | "rate_limited" | "needs_reauth" | "error" | "skipped";
  requests: number;
  rows: number;
  days: number;
  finalizedThrough: string | null;
  error?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);
// Index rows cannot hold arbitrarily long keys, and a NUL byte cannot be stored at all.
const storable = (key: string | undefined): key is string => typeof key === "string" && key.length > 0 && key.length <= 1500 && !key.includes("\u0000");

export function backfillProgress(property: Pick<SiteProperty, "backfillTarget" | "oldestSyncedDate" | "finalizedThrough">): { done: number; total: number; complete: boolean } | null {
  if (!property.finalizedThrough || !property.backfillTarget) return null;
  const total = Math.max(1, daysInclusive(property.backfillTarget, property.finalizedThrough));
  const done = property.oldestSyncedDate ? Math.min(total, daysInclusive(property.oldestSyncedDate, property.finalizedThrough)) : 0;
  return { done, total, complete: done >= total };
}

/**
 * Brings one property up to date, then works backwards through its history.
 *
 * Property totals are requested on their own (by date, aggregated by property) and stored
 * as the totals. Query and page rows are requested per day and are detail only: they are
 * never summed to produce a total, because Google leaves anonymized queries out of them.
 * Every write replaces whole days, so a retry or a recheck cannot double count.
 */
export async function syncProperty(db: Database, propertyId: string, options: SyncOptions): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const maxRunMs = options.maxRunMs ?? 8 * 60_000;
  const chunkDays = options.chunkDays ?? 7;
  const dayRowCap = options.dayRowCap ?? 50_000;
  const pairRowCap = options.pairRowCap ?? 5_000;
  const log = options.log ?? (() => {});
  const counters = { requests: 0, rows: 0, days: 0, truncated: false };

  const property = await getProperty(db, propertyId);
  if (!property || !property.enabled || property.isDemo) return { status: "skipped", requests: 0, rows: 0, days: 0, finalizedThrough: null };
  const integration = await getIntegration(db, property.integrationId);
  if (!integration) return { status: "skipped", requests: 0, rows: 0, days: 0, finalizedThrough: null };

  const first = !property.oldestSyncedDate;
  const runId = await startGscSyncRun(db, { siteId: property.siteId, propertyId, profile: first ? "first" : "incremental" });
  let span: { from: string; to: string } | null = null;
  let finalized: string | null = property.finalizedThrough;

  let token: string | null = null;
  /** One paced Google call. A rejected cached token is refreshed once before it counts as revoked. */
  const paced = async <T>(work: (accessToken: string) => Promise<T>): Promise<T> => {
    if (counters.requests > 0 && options.requestDelayMs) await sleep(options.requestDelayMs);
    counters.requests++;
    token ??= await getAccessToken(db, integration, options);
    try {
      return await work(token);
    } catch (error) {
      if (!(error instanceof GoogleAuthError)) throw error;
      token = await getAccessToken(db, integration, options, { force: true });
      return work(token);
    }
  };
  const query = (request: SearchAnalyticsRequest) =>
    paced((accessToken) => querySearchAnalytics(options.google, accessToken, property.externalPropertyId, { type: GSC_SEARCH_TYPE, ...request }));
  const queryAll = async (request: SearchAnalyticsRequest, maxRows: number): Promise<SearchAnalyticsRow[]> => {
    const rows: SearchAnalyticsRow[] = [];
    for (;;) {
      const limit = Math.min(25_000, maxRows - rows.length);
      const response = await query({ ...request, rowLimit: limit, startRow: rows.length });
      const page = response.rows ?? [];
      rows.push(...page);
      if (page.length < limit) return rows;
      if (rows.length >= maxRows) {
        counters.truncated = true;
        return rows;
      }
    }
  };

  const scope = (from: string, to: string) => ({ propertyId, siteId: property.siteId, from, to });

  /** Property totals and the device split for a span: two small requests. */
  const syncTotals = async (from: string, to: string) => {
    const totals = await queryAll({ startDate: from, endDate: to, dimensions: ["date"], aggregationType: "byProperty", dataState: "final" }, 25_000);
    await replaceGscSiteDaily(
      db,
      scope(from, to),
      totals.filter((r) => storable(r.keys[0])).map((r) => ({ date: r.keys[0]!, ...toStored(r) })),
    );
    const devices = await queryAll({ startDate: from, endDate: to, dimensions: ["date", "device"], aggregationType: "byProperty", dataState: "final" }, 25_000);
    await replaceGscSegments(
      db,
      scope(from, to),
      "device",
      devices.filter((r) => storable(r.keys[1])).map((r) => ({ date: r.keys[0]!, value: r.keys[1]!.toLowerCase(), ...toStored(r) })),
    );
    counters.rows += totals.length + devices.length;
  };

  /** Query, page, pair and country detail for a span, one day at a time. */
  const syncDetail = async (from: string, to: string) => {
    const dates = await gscDatesWithData(db, propertyId, from, to);
    const detail: GscDetailRows = { queries: [], pages: [], queryPages: [] };
    if (dates.length) {
      const countries = await queryAll({ startDate: from, endDate: to, dimensions: ["date", "country"], aggregationType: "byProperty", dataState: "final" }, 100_000);
      await replaceGscSegments(
        db,
        scope(from, to),
        "country",
        countries.filter((r) => storable(r.keys[1])).map((r) => ({ date: r.keys[0]!, value: r.keys[1]!.toLowerCase(), ...toStored(r) })),
      );
      counters.rows += countries.length;
    } else {
      await replaceGscSegments(db, scope(from, to), "country", []);
    }
    for (const date of dates) {
      const day = { startDate: date, endDate: date, dataState: "final" as const };
      const queries = await queryAll({ ...day, dimensions: ["query"], aggregationType: "byProperty" }, dayRowCap);
      const pages = await queryAll({ ...day, dimensions: ["page"], aggregationType: "byPage" }, dayRowCap);
      const pairs = (await query({ ...day, dimensions: ["query", "page"], aggregationType: "byPage", rowLimit: pairRowCap })).rows ?? [];
      for (const r of queries) if (storable(r.keys[0])) detail.queries.push({ date, query: r.keys[0], ...toStored(r) });
      for (const r of pages) if (storable(r.keys[0])) detail.pages.push({ date, pageUrl: r.keys[0], ...toStored(r) });
      for (const r of pairs) if (storable(r.keys[0]) && storable(r.keys[1])) detail.queryPages.push({ date, query: r.keys[0], pageUrl: r.keys[1], ...toStored(r) });
    }
    await replaceGscDetail(db, scope(from, to), detail);
    counters.rows += detail.queries.length + detail.pages.length + detail.queryPages.length;
    counters.days += daysInclusive(from, to);
    span = { from: span ? minDate(span.from, from) : from, to: span ? maxDate(span.to, to) : to };
  };

  const finish = async (status: SyncResult["status"] & ("done" | "partial" | "rate_limited" | "needs_reauth" | "error"), error?: string): Promise<SyncResult> => {
    await finishGscSyncRun(db, runId, {
      status,
      fromDate: span?.from ?? null,
      toDate: span?.to ?? null,
      rowCount: counters.rows,
      requestCount: counters.requests,
      truncated: counters.truncated,
      quotaLimited: status === "rate_limited",
      error: error ?? null,
    });
    log("gsc sync finished", { propertyId, status, ...counters, error });
    return { status, requests: counters.requests, rows: counters.rows, days: counters.days, finalizedThrough: finalized, error };
  };

  try {
    const today = localDateOf(now, GSC_TIMEZONE);
    finalized = await probeFinalizedThrough(query, today);
    const floor = addDays(today, -GSC_MAX_HISTORY_DAYS);
    const target = property.backfillTarget ? maxDate(property.backfillTarget, floor) : floor;

    // The last seven finalized days are always fetched again: Google adjusts them late.
    const recheckFrom = maxDate(target, addDays(finalized, -6));
    const recentFrom = first ? recheckFrom : maxDate(target, minDate(recheckFrom, addDays(property.finalizedThrough ?? finalized, 1)));
    await syncTotals(first ? target : recentFrom, finalized);
    await syncDetail(recentFrom, finalized);

    let oldest = property.oldestSyncedDate ? minDate(property.oldestSyncedDate, recentFrom) : recentFrom;
    await updateProperty(db, propertyId, { finalizedThrough: finalized, oldestSyncedDate: oldest, backfillTarget: target, syncHeartbeatAt: new Date() });

    while (oldest > target && Date.now() - startedAt < maxRunMs) {
      const to = addDays(oldest, -1);
      const from = maxDate(target, addDays(to, -(chunkDays - 1)));
      await syncDetail(from, to);
      oldest = from;
      // Checkpoint: an interrupted backfill resumes from here.
      await updateProperty(db, propertyId, { oldestSyncedDate: oldest, syncHeartbeatAt: new Date() });
    }

    await refreshOpportunities(db, propertyId);

    const complete = oldest <= target;
    await updateProperty(db, propertyId, {
      syncStatus: "idle",
      lastSyncAt: new Date(),
      lastError: null,
      failureStreak: 0,
      // Unfinished history continues on the next tick; a finished property waits for the next day.
      nextSyncAt: complete ? new Date(Date.now() + (options.syncIntervalHours ?? 24) * 3_600_000) : new Date(),
    });
    return finish(complete ? "done" : "partial");
  } catch (error) {
    const streak = property.failureStreak + 1;
    if (error instanceof GoogleAuthError) {
      await markIntegrationNeedsReauth(db, integration.id, error.message);
      await updateProperty(db, propertyId, { syncStatus: "idle", lastError: null });
      return finish("needs_reauth", error.message);
    }
    if (error instanceof GoogleRateLimitError) {
      const wait = error.retryAfterMs ?? Math.min(60_000 * 2 ** (streak - 1), 3_600_000);
      await updateProperty(db, propertyId, {
        syncStatus: "rate_limited",
        failureStreak: streak,
        lastError: "Google rate limit reached",
        nextSyncAt: new Date(Date.now() + wait),
      });
      return finish("rate_limited", "Google rate limit reached");
    }
    const message =
      error instanceof GooglePermissionError ? "This Google account can no longer read the property" : ((error as Error).message ?? "Sync failed").slice(0, 200);
    const wait = error instanceof GooglePermissionError ? 24 * 3_600_000 : Math.min(5 * 60_000 * 2 ** (streak - 1), 6 * 3_600_000);
    await updateProperty(db, propertyId, { syncStatus: "error", failureStreak: streak, lastError: message, nextSyncAt: new Date(Date.now() + wait) });
    return finish("error", message);
  }
}

/**
 * Newest date Google considers final. Asking for fresh data makes Google say where the
 * incomplete days begin; if it does not, the newest day in a final-only request is used.
 * Only when both are silent (a property with no recent impressions) is the usual three-day lag assumed.
 */
async function probeFinalizedThrough(
  query: (request: SearchAnalyticsRequest) => Promise<{ rows?: SearchAnalyticsRow[]; metadata?: { first_incomplete_date?: string } }>,
  today: string,
): Promise<string> {
  const range = { startDate: addDays(today, -10), endDate: today, dimensions: ["date" as const], aggregationType: "byProperty" as const };
  const fresh = await query({ ...range, dataState: "all" });
  const incomplete = fresh.metadata?.first_incomplete_date;
  if (incomplete && /^\d{4}-\d{2}-\d{2}$/.test(incomplete)) return addDays(incomplete, -1);
  const final = await query({ ...range, dataState: "final" });
  const newest = (final.rows ?? []).map((r) => r.keys[0]).filter((d): d is string => !!d).sort().at(-1);
  return newest ?? addDays(today, -3);
}

/** Runs the rules over the last 28 finalized days and stores what they find. */
export async function refreshOpportunities(db: Database, propertyId: string): Promise<number> {
  const property = await getProperty(db, propertyId);
  if (!property?.finalizedThrough) return 0;
  const days = OPPORTUNITY_THRESHOLDS.windowDays;
  const window = { from: addDays(property.finalizedThrough, -(days - 1)), to: property.finalizedThrough };
  const previousWindow = { from: addDays(window.from, -days), to: addDays(window.from, -1) };
  const inputs = await gscOpportunityInputs(db, propertyId, window, previousWindow);
  const detected = detectOpportunities({ window, previousWindow, historyFrom: property.oldestSyncedDate, ...inputs });
  await saveOpportunities(db, { propertyId, siteId: property.siteId }, detected);
  return detected.length;
}

import { aggregateDay, type DayEvent, type GoalDefinition } from "@scopekit/analytics";
import { VISITOR_METRIC_MODES, type DeviceType, type EventType, type PrivacyMode } from "@scopekit/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  aggregationDirty,
  dimensionDailyMetrics,
  eventDailyMetrics,
  goalDailyMetrics,
  goals,
  pageDailyMetrics,
  siteDailyMetrics,
  sourceDailyMetrics,
} from "../schema";
import { chunk, iso, rows } from "../util";

type Executor = Pick<Database, "execute">;

export type DirtyDay = { siteId: string; localDate: string; markedAt: string };

export async function takeDirtyDays(db: Database, limit = 200): Promise<DirtyDay[]> {
  return rows<DirtyDay>(
    db,
    sql`select site_id as "siteId", local_date::text as "localDate", marked_at::text as "markedAt"
        from aggregation_dirty order by marked_at limit ${limit}`,
  );
}

/** Clears the marker only if nothing re-marked the day while it was being recomputed. */
export async function clearDirtyDay(db: Database, day: DirtyDay): Promise<void> {
  await db.execute(
    sql`delete from aggregation_dirty
        where site_id = ${day.siteId} and local_date = ${day.localDate}::date and marked_at = ${day.markedAt}::timestamptz`,
  );
}

/** Queues every day that still has raw events, e.g. after a goal or timezone change. */
export async function markDirtyRetainedDays(db: Executor, siteId: string): Promise<void> {
  await db.execute(sql`
    insert into aggregation_dirty (site_id, local_date, marked_at)
    select distinct e.site_id, (e.occurred_at at time zone s.timezone)::date, now()
    from analytics_events e join sites s on s.id = e.site_id
    where e.site_id = ${siteId} and not e.bot_flag
    on conflict (site_id, local_date) do update set marked_at = now()`);
}

type EventRow = {
  eventType: EventType;
  eventName: string | null;
  occurredAt: string;
  receivedAt: string;
  normalizedPath: string;
  sessionKey: string;
  visitorKey: string | null;
  referrerDomain: string | null;
  source: string;
  medium: string;
  campaign: string | null;
  countryCode: string | null;
  deviceType: DeviceType;
  browserFamily: string;
  props: DayEvent["props"];
  engagedMs: number | null;
};

export type RecomputeResult = "recomputed" | "skipped_site_gone" | "skipped_beyond_retention";

/**
 * Rebuilds one site-local day from raw events and replaces its rollup rows in a single
 * transaction. Days older than raw retention are left alone: their events are gone, and
 * recomputing would erase history that the retention purge is required to keep.
 */
export async function recomputeDay(db: Database, siteId: string, localDate: string): Promise<RecomputeResult> {
  const [site] = await rows<{ timezone: string; privacyMode: PrivacyMode; retained: boolean }>(
    db,
    sql`select s.timezone, s.privacy_mode as "privacyMode",
               ${localDate}::date >= (now() at time zone s.timezone)::date - st.retention_days as retained
        from sites s join site_settings st on st.site_id = s.id
        where s.id = ${siteId} and s.deleted_at is null`,
  );
  if (!site) return "skipped_site_gone";
  if (!site.retained) return "skipped_beyond_retention";

  const [eventRows, goalRows] = await Promise.all([
    rows<EventRow>(
      db,
      sql`select event_type as "eventType", event_name as "eventName", ${iso(sql`occurred_at`)} as "occurredAt",
                 ${iso(sql`received_at`)} as "receivedAt", normalized_path as "normalizedPath",
                 session_key as "sessionKey", visitor_key as "visitorKey", referrer_domain as "referrerDomain",
                 source, medium, campaign, country_code as "countryCode", device_type as "deviceType",
                 browser_family as "browserFamily", props, engaged_ms as "engagedMs"
          from analytics_events
          where site_id = ${siteId} and not bot_flag
            and occurred_at >= (${localDate}::date::timestamp at time zone ${site.timezone})
            and occurred_at < ((${localDate}::date + 1)::timestamp at time zone ${site.timezone})`,
    ),
    db.select().from(goals).where(eq(goals.siteId, siteId)),
  ]);

  const events: DayEvent[] = eventRows.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) }));
  const goalDefs: GoalDefinition[] = goalRows.map((g) => ({ id: g.id, enabled: g.enabled, rules: g.matchingRules }));
  const visitorMode = VISITOR_METRIC_MODES[site.privacyMode];
  const result = aggregateDay(events, goalDefs, visitorMode);
  const watermark = eventRows.reduce<string | null>((max, r) => (max === null || r.receivedAt > max ? r.receivedAt : max), null);
  const key = { siteId, localDate };

  await db.transaction(async (tx) => {
    const day = <T extends { siteId: unknown; localDate: unknown }>(t: T) =>
      and(eq(t.siteId as never, siteId), eq(t.localDate as never, localDate));
    await tx.delete(siteDailyMetrics).where(day(siteDailyMetrics));
    await tx.delete(pageDailyMetrics).where(day(pageDailyMetrics));
    await tx.delete(sourceDailyMetrics).where(day(sourceDailyMetrics));
    await tx.delete(eventDailyMetrics).where(day(eventDailyMetrics));
    await tx.delete(dimensionDailyMetrics).where(day(dimensionDailyMetrics));
    await tx.delete(goalDailyMetrics).where(day(goalDailyMetrics));
    if (events.length === 0) return;

    await tx.insert(siteDailyMetrics).values({
      ...key,
      visitorMode,
      ...result.site,
      dataWatermark: watermark ? new Date(watermark) : null,
      updatedAt: new Date(),
    });
    for (const part of chunk(result.pages, 500)) {
      await tx.insert(pageDailyMetrics).values(part.map(({ path, ...p }) => ({ ...key, normalizedPath: path, ...p })));
    }
    for (const part of chunk(result.sources, 500)) await tx.insert(sourceDailyMetrics).values(part.map((s) => ({ ...key, ...s })));
    for (const part of chunk(result.events, 500)) await tx.insert(eventDailyMetrics).values(part.map((e) => ({ ...key, ...e })));
    for (const part of chunk(result.dimensions, 500)) await tx.insert(dimensionDailyMetrics).values(part.map((d) => ({ ...key, ...d })));
    for (const part of chunk(result.goals, 500)) await tx.insert(goalDailyMetrics).values(part.map((g) => ({ ...key, ...g })));
  });
  return "recomputed";
}

/** Drains the dirty list. Safe to run concurrently with ingestion and to re-run after a crash. */
export async function runAggregation(db: Database): Promise<{ days: number; skipped: number }> {
  let days = 0;
  let skipped = 0;
  for (let batch = 0; batch < 20; batch++) {
    const dirty = await takeDirtyDays(db);
    if (dirty.length === 0) break;
    for (const day of dirty) {
      const outcome = await recomputeDay(db, day.siteId, day.localDate);
      if (outcome === "recomputed") days++;
      else skipped++;
      await clearDirtyDay(db, day);
    }
  }
  return { days, skipped };
}

/**
 * Deletes raw events older than each site's retention, in whole site-local days.
 * Rollup tables are untouched, so reporting history outlives the raw events.
 */
export async function purgeExpiredEvents(db: Database): Promise<number> {
  const result = await rows<{ deleted: number }>(
    db,
    sql`with gone as (
          delete from analytics_events e
          using sites s join site_settings st on st.site_id = s.id
          where e.site_id = s.id
            and e.occurred_at < (((now() at time zone s.timezone)::date - st.retention_days)::timestamp at time zone s.timezone)
          returning 1
        ) select count(*)::int as deleted from gone`,
  );
  return result[0]?.deleted ?? 0;
}

export async function purgeOldVisitorSalts(db: Database): Promise<void> {
  await db.execute(sql`delete from visitor_salts where local_date < (now() at time zone 'UTC')::date - 2`);
}

/** Irreversibly removes soft-deleted sites; every site-scoped table cascades. */
export async function purgeDeletedSites(db: Database): Promise<number> {
  const result = await rows<{ deleted: number }>(
    db,
    sql`with gone as (delete from sites where deleted_at is not null returning 1) select count(*)::int as deleted from gone`,
  );
  return result[0]?.deleted ?? 0;
}

export { aggregationDirty };

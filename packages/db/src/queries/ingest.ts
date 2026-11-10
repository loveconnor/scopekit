import type { PrivacyMode, QueuedEvent } from "@scopekit/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Database } from "../client";
import { siteCredentials, siteDomains, sites, siteSettings, visitorSalts } from "../schema";
import { rows } from "../util";

export type CollectorSite = {
  siteId: string;
  timezone: string;
  privacyMode: PrivacyMode;
  hostnames: string[];
  trackingEnabled: boolean;
  geolocationEnabled: boolean;
  allowedQueryParams: string[];
  excludedPathPatterns: string[];
};

/** Everything the collector needs to validate an event for a public tracking ID. */
export async function loadCollectorSite(db: Database, publicTrackingId: string): Promise<CollectorSite | null> {
  const [row] = await db
    .select({
      siteId: sites.id,
      timezone: sites.timezone,
      privacyMode: sites.privacyMode,
      trackingEnabled: siteSettings.trackingEnabled,
      geolocationEnabled: siteSettings.geolocationEnabled,
      allowedQueryParams: siteSettings.allowedQueryParams,
      excludedPathPatterns: siteSettings.excludedPathPatterns,
    })
    .from(siteCredentials)
    .innerJoin(sites, eq(sites.id, siteCredentials.siteId))
    .innerJoin(siteSettings, eq(siteSettings.siteId, sites.id))
    .where(
      and(
        eq(siteCredentials.publicTrackingId, publicTrackingId),
        isNull(siteCredentials.revokedAt),
        isNull(sites.deletedAt),
        eq(sites.isDemo, false),
      ),
    );
  if (!row) return null;
  const domains = await db.select({ hostname: siteDomains.hostname }).from(siteDomains).where(eq(siteDomains.siteId, row.siteId));
  return { ...row, hostnames: domains.map((d) => d.hostname) };
}

/** Random salt for one calendar date, created on first use. Deleted by the retention job. */
export async function getVisitorSalt(db: Database, localDate: string): Promise<string> {
  await db
    .insert(visitorSalts)
    .values({ localDate, salt: randomBytes(32).toString("hex") })
    .onConflictDoNothing();
  const [row] = await db.select({ salt: visitorSalts.salt }).from(visitorSalts).where(eq(visitorSalts.localDate, localDate));
  return row!.salt;
}

/**
 * Stores events once. A repeated `(site_id, id)` is ignored, and only rows that were actually
 * inserted mark their site-local day for re-aggregation, so retries cannot double count.
 */
export async function insertEvents(db: Database, events: readonly QueuedEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const payload = JSON.stringify(
    events.map((e) => ({
      id: e.id,
      site_id: e.siteId,
      event_type: e.eventType,
      event_name: e.eventName,
      occurred_at: e.occurredAt,
      received_at: e.receivedAt,
      normalized_path: e.normalizedPath,
      session_key: e.sessionKey,
      visitor_key: e.visitorKey,
      referrer_domain: e.referrerDomain,
      source: e.source,
      medium: e.medium,
      campaign: e.campaign,
      country_code: e.countryCode,
      device_type: e.deviceType,
      browser_family: e.browserFamily,
      props: e.props,
      engaged_ms: e.engagedMs,
      bot_flag: e.botFlag,
    })),
  );
  const result = await rows<{ inserted: number }>(
    db,
    sql`
    with incoming as (
      select * from jsonb_to_recordset(${payload}::jsonb) as x(
        id uuid, site_id uuid, event_type text, event_name text, occurred_at timestamptz, received_at timestamptz,
        normalized_path text, session_key text, visitor_key text, referrer_domain text, source text, medium text,
        campaign text, country_code text, device_type text, browser_family text, props jsonb, engaged_ms int, bot_flag boolean
      )
    ),
    ins as (
      insert into analytics_events (
        id, site_id, event_type, event_name, occurred_at, received_at, normalized_path, session_key, visitor_key,
        referrer_domain, source, medium, campaign, country_code, device_type, browser_family, props, engaged_ms, bot_flag
      )
      select i.id, i.site_id, i.event_type, i.event_name, i.occurred_at, i.received_at, i.normalized_path, i.session_key,
             i.visitor_key, i.referrer_domain, i.source, i.medium, i.campaign, i.country_code, i.device_type,
             i.browser_family, coalesce(i.props, '{}'::jsonb), i.engaged_ms, i.bot_flag
      from incoming i
      join sites s on s.id = i.site_id and s.deleted_at is null
      on conflict (site_id, id) do nothing
      returning site_id, occurred_at, bot_flag
    ),
    dirty as (
      insert into aggregation_dirty (site_id, local_date, marked_at)
      select distinct ins.site_id, (ins.occurred_at at time zone s.timezone)::date, now()
      from ins join sites s on s.id = ins.site_id
      where not ins.bot_flag
      on conflict (site_id, local_date) do update set marked_at = now()
    ),
    touched as (
      update sites s
      set first_event_at = least(coalesce(s.first_event_at, agg.first_at), agg.first_at),
          last_event_at = greatest(coalesce(s.last_event_at, agg.last_at), agg.last_at),
          status = case when s.status = 'pending_setup' then 'active' else s.status end
      from (select site_id, min(occurred_at) first_at, max(occurred_at) last_at from ins where not bot_flag group by site_id) agg
      where s.id = agg.site_id
    )
    select count(*)::int as inserted from ins`,
  );
  return result[0]?.inserted ?? 0;
}

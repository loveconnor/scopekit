import type { AlertEvidence, AlertSeverity, AlertStatus, AlertType, AnnotationType, CruxFormFactor, LabMetrics, LabOpportunity, LabScores, PerfDevice } from "@scopekit/contracts";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "../client";
import { alertRules, alerts, annotations, cruxHistory, performanceRuns, siteSettings } from "../schema";
import { rows } from "../util";

const UUID = /^[0-9a-f-]{36}$/i;

/* ----------------------------------------------------------------------------
 * Lab runs (Lighthouse through PageSpeed Insights)
 * ------------------------------------------------------------------------- */

export type PerformanceRun = typeof performanceRuns.$inferSelect;
export type PerformanceRunSummary = Omit<PerformanceRun, "raw">;

const summaryColumns = {
  id: performanceRuns.id,
  siteId: performanceRuns.siteId,
  url: performanceRuns.url,
  device: performanceRuns.device,
  provider: performanceRuns.provider,
  trigger: performanceRuns.trigger,
  status: performanceRuns.status,
  queuedAt: performanceRuns.queuedAt,
  checkedAt: performanceRuns.checkedAt,
  finalUrl: performanceRuns.finalUrl,
  lighthouseVersion: performanceRuns.lighthouseVersion,
  scores: performanceRuns.scores,
  metrics: performanceRuns.metrics,
  opportunities: performanceRuns.opportunities,
  error: performanceRuns.error,
};

/** Queues a lab run unless the same URL and device is already waiting. Returns null in that case. */
export async function queuePerformanceRun(db: Database, input: { siteId: string; url: string; device: PerfDevice; trigger: "manual" | "scheduled" }): Promise<string | null> {
  const [waiting] = await db
    .select({ id: performanceRuns.id })
    .from(performanceRuns)
    .where(and(eq(performanceRuns.siteId, input.siteId), eq(performanceRuns.url, input.url), eq(performanceRuns.device, input.device), inArray(performanceRuns.status, ["queued", "running"])))
    .limit(1);
  if (waiting) return null;
  const [row] = await db.insert(performanceRuns).values(input).returning({ id: performanceRuns.id });
  return row!.id;
}

export async function countPerformanceRunsSince(db: Database, siteId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(performanceRuns)
    .where(and(eq(performanceRuns.siteId, siteId), gte(performanceRuns.queuedAt, since), sql`${performanceRuns.provider} = 'psi'`));
  return row?.n ?? 0;
}

/**
 * Queues the scheduled runs: the homepage daily on both devices, the site's priority pages
 * weekly. Only for sites whose owner has started a run before, so nothing calls the provider
 * for a site nobody asked about.
 */
export async function scheduleDuePerformanceRuns(db: Database): Promise<number> {
  const sites = await rows<{ site_id: string; origin: string; urls: string[] }>(
    db,
    sql`select s.id as site_id, s.canonical_origin as origin, st.performance_urls as urls
        from sites s join site_settings st on st.site_id = s.id
        where s.deleted_at is null and not s.is_demo
          and exists (select 1 from performance_runs r where r.site_id = s.id and r.trigger = 'manual')`,
  );
  let queued = 0;
  for (const site of sites) {
    const targets = [{ url: `${site.origin}/`, hours: 23 }, ...site.urls.filter((u) => u !== `${site.origin}/`).slice(0, 10).map((url) => ({ url, hours: 24 * 7 - 1 }))];
    for (const target of targets) {
      for (const device of ["mobile", "desktop"] as const) {
        const [recent] = await db
          .select({ id: performanceRuns.id })
          .from(performanceRuns)
          .where(and(eq(performanceRuns.siteId, site.site_id), eq(performanceRuns.url, target.url), eq(performanceRuns.device, device), sql`${performanceRuns.queuedAt} > now() - make_interval(hours => ${target.hours})`))
          .limit(1);
        if (!recent && (await queuePerformanceRun(db, { siteId: site.site_id, url: target.url, device, trigger: "scheduled" }))) queued++;
      }
    }
  }
  return queued;
}

export async function claimQueuedPerformanceRuns(db: Database, limit = 4): Promise<string[]> {
  // A run left in "running" by a stopped worker is failed, so it can be requested again.
  await db.execute(sql`update performance_runs set status = 'error', error = 'The worker stopped before the run finished', checked_at = now() where status = 'running' and queued_at < now() - interval '15 minutes'`);
  const claimed = await rows<{ id: string }>(
    db,
    sql`update performance_runs r set status = 'running'
        where r.id in (select id from performance_runs where status = 'queued' order by queued_at limit ${limit} for update skip locked)
        returning r.id`,
  );
  return claimed.map((r) => r.id);
}

export async function getPerformanceRun(db: Database, id: string): Promise<PerformanceRunSummary | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select(summaryColumns).from(performanceRuns).where(eq(performanceRuns.id, id));
  return row ?? null;
}

export async function finishPerformanceRun(
  db: Database,
  id: string,
  outcome:
    | { status: "done"; finalUrl: string | null; lighthouseVersion: string | null; scores: LabScores; metrics: LabMetrics; opportunities: LabOpportunity[]; raw: Record<string, unknown>; checkedAt: Date }
    | { status: "error"; error: string },
): Promise<void> {
  await db
    .update(performanceRuns)
    .set(outcome.status === "done" ? outcome : { status: "error", error: outcome.error.slice(0, 300), checkedAt: new Date() })
    .where(eq(performanceRuns.id, id));
}

/** Full provider payloads are kept for the ten newest runs per site; summaries are kept for all. */
export async function prunePerformanceRaw(db: Database, siteId: string): Promise<void> {
  await db.execute(
    sql`update performance_runs set raw = null where site_id = ${siteId} and raw is not null
        and id not in (select id from performance_runs where site_id = ${siteId} and raw is not null order by queued_at desc limit 10)`,
  );
}

/** Finished and failed runs for one URL and device, newest first. */
export async function performanceHistory(db: Database, siteId: string, url: string, device: PerfDevice, limit = 60): Promise<PerformanceRunSummary[]> {
  return db
    .select(summaryColumns)
    .from(performanceRuns)
    .where(and(eq(performanceRuns.siteId, siteId), eq(performanceRuns.url, url), eq(performanceRuns.device, device)))
    .orderBy(desc(performanceRuns.queuedAt))
    .limit(limit);
}

export async function performanceUrls(db: Database, siteId: string): Promise<string[]> {
  const result = await rows<{ url: string }>(db, sql`select url from performance_runs where site_id = ${siteId} group by url order by min(queued_at)`);
  return result.map((r) => r.url);
}

/** Newest finished mobile and desktop run for a URL. */
export async function latestPerformance(db: Database, siteId: string, url: string): Promise<Partial<Record<PerfDevice, PerformanceRunSummary>>> {
  const result = await db
    .selectDistinctOn([performanceRuns.device], summaryColumns)
    .from(performanceRuns)
    .where(and(eq(performanceRuns.siteId, siteId), eq(performanceRuns.url, url), eq(performanceRuns.status, "done")))
    .orderBy(performanceRuns.device, desc(performanceRuns.queuedAt));
  return Object.fromEntries(result.map((r) => [r.device, r]));
}

/* ----------------------------------------------------------------------------
 * Field data (Chrome UX Report)
 * ------------------------------------------------------------------------- */

export type CruxRow = typeof cruxHistory.$inferSelect;

export async function upsertCruxHistory(db: Database, values: (typeof cruxHistory.$inferInsert)[]): Promise<void> {
  if (!values.length) return;
  await db
    .insert(cruxHistory)
    .values(values)
    .onConflictDoUpdate({
      target: [cruxHistory.siteId, cruxHistory.key, cruxHistory.formFactor, cruxHistory.periodEnd],
      set: { lcpP75: sql`excluded.lcp_p75`, inpP75: sql`excluded.inp_p75`, clsP75: sql`excluded.cls_p75`, periodStart: sql`excluded.period_start`, importedAt: new Date() },
    });
}

export async function setCruxStatus(db: Database, siteId: string, status: NonNullable<typeof siteSettings.$inferSelect.cruxStatus>): Promise<void> {
  await db.update(siteSettings).set({ cruxStatus: status }).where(eq(siteSettings.siteId, siteId));
}

export async function cruxSeries(db: Database, siteId: string, formFactor: CruxFormFactor, limit = 40): Promise<CruxRow[]> {
  const result = await db
    .select()
    .from(cruxHistory)
    .where(and(eq(cruxHistory.siteId, siteId), eq(cruxHistory.formFactor, formFactor)))
    .orderBy(desc(cruxHistory.periodEnd))
    .limit(limit);
  return result.reverse();
}

/** Sites due for their weekly field-data import. */
export async function sitesDueForCrux(db: Database): Promise<{ siteId: string; origin: string }[]> {
  return rows<{ siteId: string; origin: string }>(
    db,
    sql`select s.id as "siteId", s.canonical_origin as origin from sites s join site_settings st on st.site_id = s.id
        where s.deleted_at is null and not s.is_demo
          and exists (select 1 from performance_runs r where r.site_id = s.id and r.trigger = 'manual')
          and (st.crux_status is null or (st.crux_status->>'checkedAt')::timestamptz < now() - interval '7 days')`,
  );
}

/* ----------------------------------------------------------------------------
 * Alerts
 * ------------------------------------------------------------------------- */

export type Alert = typeof alerts.$inferSelect;
export type AlertRuleSetting = { type: AlertType; enabled: boolean; email: boolean };

export async function listAlertRules(db: Database, siteId: string): Promise<AlertRuleSetting[]> {
  return db.select({ type: alertRules.type, enabled: alertRules.enabled, email: alertRules.email }).from(alertRules).where(eq(alertRules.siteId, siteId));
}

export async function saveAlertRule(db: Database, siteId: string, type: AlertType, patch: { enabled?: boolean; email?: boolean }): Promise<void> {
  await db
    .insert(alertRules)
    .values({ siteId, type, enabled: patch.enabled ?? true, email: patch.email ?? false })
    .onConflictDoUpdate({
      target: [alertRules.siteId, alertRules.type],
      set: { ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), ...(patch.email === undefined ? {} : { email: patch.email }), updatedAt: new Date() },
    });
}

export type AlertCandidate = {
  siteId: string;
  type: AlertType;
  /** What the alert is about within the site: a URL, a rule, a property. Empty for the site itself. */
  entity: string;
  /** The period or event the alert belongs to. A new window is a new alert. */
  window: string;
  severity: AlertSeverity;
  headline: string;
  evidence: AlertEvidence;
  /** No second alert for the same site, type and entity within this many days. */
  cooldownDays?: number;
};

export const alertFingerprint = (c: Pick<AlertCandidate, "siteId" | "type" | "entity" | "window">) => `${c.siteId}|${c.type}|${c.entity}|${c.window}`;

/**
 * Raises an alert once. The same event seen again only refreshes `last_seen_at`, whatever
 * state the owner put the alert in, and a cooldown keeps a rolling condition from producing
 * a new alert every day. Returns the alert when it was newly created.
 */
export async function raiseAlert(db: Database, candidate: AlertCandidate): Promise<Alert | null> {
  const fingerprint = alertFingerprint(candidate);
  const seen = await db.update(alerts).set({ lastSeenAt: new Date(), evidence: candidate.evidence }).where(eq(alerts.fingerprint, fingerprint)).returning({ id: alerts.id });
  if (seen.length) return null;
  if (candidate.cooldownDays) {
    const [recent] = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(
        and(
          eq(alerts.siteId, candidate.siteId),
          eq(alerts.type, candidate.type),
          eq(alerts.entity, candidate.entity),
          sql`${alerts.createdAt} > now() - make_interval(days => ${candidate.cooldownDays})`,
        ),
      )
      .limit(1);
    if (recent) return null;
  }
  const [row] = await db
    .insert(alerts)
    .values({ siteId: candidate.siteId, type: candidate.type, fingerprint, entity: candidate.entity, severity: candidate.severity, headline: candidate.headline, evidence: candidate.evidence })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** Closes open alerts of a type whose condition no longer holds, e.g. tracking that resumed. */
export async function resolveClearedAlerts(db: Database, siteId: string, type: AlertType, stillActiveEntities: string[]): Promise<number> {
  const result = await db
    .update(alerts)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      and(
        eq(alerts.siteId, siteId),
        eq(alerts.type, type),
        inArray(alerts.status, ["open", "acknowledged", "snoozed"]),
        stillActiveEntities.length ? sql`${alerts.entity} not in (${sql.join(stillActiveEntities.map((e) => sql`${e}`), sql`, `)})` : undefined,
      ),
    )
    .returning({ id: alerts.id });
  return result.length;
}

export async function listAlerts(db: Database, opts: { siteIds: string[]; statuses?: AlertStatus[]; limit?: number }): Promise<Alert[]> {
  if (!opts.siteIds.length) return [];
  return db
    .select()
    .from(alerts)
    .where(and(inArray(alerts.siteId, opts.siteIds), opts.statuses?.length ? inArray(alerts.status, opts.statuses) : undefined))
    .orderBy(sql`array_position(array['critical','warning'], ${alerts.severity})`, desc(alerts.createdAt))
    .limit(opts.limit ?? 100);
}

export async function countAlerts(db: Database, siteIds: string[]): Promise<Record<AlertStatus, number>> {
  const counts: Record<AlertStatus, number> = { open: 0, acknowledged: 0, resolved: 0, snoozed: 0 };
  if (!siteIds.length) return counts;
  const result = await db.select({ status: alerts.status, n: sql<number>`count(*)::int` }).from(alerts).where(inArray(alerts.siteId, siteIds)).groupBy(alerts.status);
  for (const r of result) counts[r.status] = r.n;
  return counts;
}

export async function setAlertStatus(db: Database, alertId: string, siteIds: string[], patch: { status: AlertStatus; until?: string | null }): Promise<Alert | null> {
  if (!UUID.test(alertId) || !siteIds.length) return null;
  const now = new Date();
  const [row] = await db
    .update(alerts)
    .set({
      status: patch.status,
      snoozedUntil: patch.status === "snoozed" ? (patch.until ?? null) : null,
      ...(patch.status === "acknowledged" ? { acknowledgedAt: now } : {}),
      ...(patch.status === "resolved" ? { resolvedAt: now } : {}),
      ...(patch.status === "open" ? { resolvedAt: null } : {}),
    })
    .where(and(eq(alerts.id, alertId), inArray(alerts.siteId, siteIds)))
    .returning();
  return row ?? null;
}

/** Snoozed alerts whose date has passed are open again. */
export async function expireAlertSnoozes(db: Database): Promise<void> {
  await db.execute(sql`update alerts set status = 'open', snoozed_until = null where status = 'snoozed' and snoozed_until < current_date`);
}

export async function markAlertEmailed(db: Database, alertId: string): Promise<void> {
  await db.update(alerts).set({ emailedAt: new Date() }).where(eq(alerts.id, alertId));
}

/* ----------------------------------------------------------------------------
 * Annotations
 * ------------------------------------------------------------------------- */

export type Annotation = typeof annotations.$inferSelect;

export async function createAnnotation(
  db: Database,
  input: { siteId: string; date: string; type: AnnotationType; title: string; note?: string | null; linkedUrl?: string | null; commitSha?: string | null },
): Promise<Annotation> {
  const [row] = await db.insert(annotations).values(input).returning();
  return row!;
}

export async function listAnnotations(db: Database, siteId: string, range?: { from: string; to: string }, limit = 50): Promise<Annotation[]> {
  return db
    .select()
    .from(annotations)
    .where(and(eq(annotations.siteId, siteId), range ? gte(annotations.date, range.from) : undefined, range ? lte(annotations.date, range.to) : undefined))
    .orderBy(desc(annotations.date), desc(annotations.createdAt))
    .limit(limit);
}

export async function deleteAnnotation(db: Database, siteId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const result = await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.siteId, siteId))).returning({ id: annotations.id });
  return result.length > 0;
}

/** Days with at least one pageview in the week before a date, as a baseline for "this site normally has traffic". */
export async function activeDaysBefore(db: Database, siteId: string, localDate: string): Promise<number> {
  const [row] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from site_daily_metrics where site_id = ${siteId} and pageviews > 0 and local_date <= ${localDate}::date and local_date > ${localDate}::date - 7`,
  );
  return row?.n ?? 0;
}

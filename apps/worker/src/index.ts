import { runCrawl } from "@scopekit/audit";
import { AUDIT_QUEUE, INGEST_QUEUE, MAINTENANCE_QUEUE, SEO_QUEUE, type QueuedEvent } from "@scopekit/contracts";
import {
  claimDueProperties,
  claimQueuedCrawls,
  claimQueuedPerformanceRuns,
  expireSnoozes,
  getCrawlRun,
  listAlertRules,
  markAlertEmailed,
  scheduleDueCrawls,
  scheduleDuePerformanceRuns,
  sitesDueForCrux,
  type Alert,
  deleteIntegration,
  finishJobRun,
  getDb,
  getProperty,
  insertEvents,
  listUnusedIntegrations,
  pruneGscSyncRuns,
  pruneJobRuns,
  purgeDeletedSites,
  purgeExpiredEvents,
  purgeOldVisitorSalts,
  runAggregation,
  startJobRun,
} from "@scopekit/db";
import { alertsForCrawl, evaluateAlerts, performanceConfigFromEnv, runPerformanceRun, syncCrux } from "@scopekit/health";
import { decryptSecret, googleConfigFromEnv, loadMasterKey, revokeToken, syncProperty } from "@scopekit/seo";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const AGGREGATE_EVERY_MS = Number(process.env.AGGREGATE_EVERY_MS ?? 60_000);

const log = (level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, service: "worker", time: new Date().toISOString(), ...fields }));

const db = getDb();
const connection = () => new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

/** Raw events from the collector. The insert is idempotent, so BullMQ retries are safe. */
const ingest = new Worker<{ events: QueuedEvent[] }>(
  INGEST_QUEUE,
  async (job) => {
    const inserted = await insertEvents(db, job.data.events);
    return { inserted, duplicates: job.data.events.length - inserted };
  },
  { connection: connection(), concurrency: 4 },
);
ingest.on("failed", (job, error) => log("error", "ingest failed", { jobId: job?.id, attempts: job?.attemptsMade, error: error.message }));

/* Search Console. Without an OAuth client and an encryption key there is nothing to sync. */
const google = googleConfigFromEnv();
const masterKey = loadMasterKey();
const searchConsole = google && masterKey ? { google, masterKey } : null;
const keep = { removeOnComplete: 50, removeOnFail: 200, attempts: 3, backoff: { type: "exponential" as const, delay: 5000 } };
const seoQueue = new Queue(SEO_QUEUE, { connection: connection() });

/**
 * One property per job. Retries are scheduled in the database (`next_sync_at`), where the
 * dashboard can show them, so a failed job is not retried by the queue as well. A worker
 * without Google credentials does not listen at all, so it can never take a job it cannot do.
 */
const seo = searchConsole
  ? new Worker<{ propertyId: string }>(
      SEO_QUEUE,
      async (job) => {
        const property = await getProperty(db, job.data.propertyId);
        const runId = await startJobRun(db, "gsc_sync", property?.siteId ?? null);
        try {
          const result = await syncProperty(db, job.data.propertyId, {
            ...searchConsole,
            requestDelayMs: Number(process.env.GSC_REQUEST_DELAY_MS ?? 150),
            syncIntervalHours: Number(process.env.GSC_SYNC_INTERVAL_HOURS ?? 24),
            log: (msg, fields) => log("info", msg, fields),
          });
          const failed = result.status === "error" || result.status === "needs_reauth";
          await finishJobRun(db, runId, { status: failed ? "error" : "done", errorCode: failed ? result.error : undefined, cursor: { ...result } });
          return result;
        } catch (error) {
          await finishJobRun(db, runId, { status: "error", errorCode: (error as Error).message });
          throw error;
        }
      },
      { connection: connection(), concurrency: 2 },
    )
  : null;
seo?.on("failed", (job, error) => log("error", "search console sync failed", { jobId: job?.id, error: error.message }));

/* Site audits and lab runs. Crawls need no credentials; PageSpeed and CrUX need GOOGLE_API_KEY. */
const performance = performanceConfigFromEnv();
const auditQueue = new Queue(AUDIT_QUEUE, { connection: connection() });

/** Email is optional and only for alerts that are critical or that the owner opted in to. */
async function emailAlerts(alerts: Alert[]): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.SCOPEKIT_EMAIL_FROM;
  const to = process.env.SCOPEKIT_ALERT_EMAIL || (process.env.SCOPEKIT_ALLOWED_EMAILS ?? "").split(",")[0]?.trim();
  if (!key || !from || !to) return;
  const appUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  for (const alert of alerts) {
    const optedIn = (await listAlertRules(db, alert.siteId)).find((r) => r.type === alert.type)?.email ?? false;
    if (alert.severity !== "critical" && !optedIn) continue;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: `ScopeKit: ${alert.headline}`, text: `${alert.headline}\n\nOpen the alert: ${appUrl}/alerts\n` }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) await markAlertEmailed(db, alert.id);
      else log("warn", "alert email failed", { alertId: alert.id, status: response.status });
    } catch {
      log("warn", "alert email failed", { alertId: alert.id });
    }
  }
}

const audit = new Worker<{ runId: string }>(
  AUDIT_QUEUE,
  async (job) => {
    if (job.name === "lighthouse") {
      if (!performance) return { status: "skipped" };
      return { status: await runPerformanceRun(db, job.data.runId, performance) };
    }
    const run = await getCrawlRun(db, job.data.runId);
    const jobRunId = await startJobRun(db, run?.kind === "recheck" ? "page_recheck" : "site_crawl", run?.siteId ?? null);
    try {
      const result = await runCrawl(db, job.data.runId, {
        // Loopback is for the fixture site in tests. Private networks stay blocked either way.
        allowLoopback: process.env.SCOPEKIT_CRAWLER_ALLOW_LOOPBACK === "1",
        minIntervalMs: Number(process.env.CRAWLER_MIN_INTERVAL_MS ?? 500),
        log: (msg, fields) => log("info", msg, fields),
      });
      await finishJobRun(db, jobRunId, { status: result.status === "error" ? "error" : "done", errorCode: result.status === "error" ? "The crawl could not run" : undefined, cursor: { ...result } });
      await emailAlerts(await alertsForCrawl(db, job.data.runId));
      return result;
    } catch (error) {
      await finishJobRun(db, jobRunId, { status: "error", errorCode: (error as Error).message });
      throw error;
    }
  },
  // One crawl per site is enforced when queueing; two sites can be crawled side by side.
  { connection: connection(), concurrency: 2 },
);
audit.on("failed", (job, error) => log("error", "audit job failed", { job: job?.name, error: error.message }));

/** Revokes and removes Google accounts that no site uses any more. */
async function removeUnusedIntegrations(): Promise<number> {
  const unused = await listUnusedIntegrations(db, 60);
  for (const integration of unused) {
    if (searchConsole && integration.encryptedRefreshToken) {
      try {
        await revokeToken(searchConsole.google, decryptSecret(integration.encryptedRefreshToken, searchConsole.masterKey));
      } catch {
        // A token that cannot be decrypted cannot be revoked either; the row is removed regardless.
      }
    }
    await deleteIntegration(db, integration.id);
  }
  return unused.length;
}

/** Records a run in job_runs so Activity can show what the worker has been doing. */
async function recorded<T extends Record<string, unknown>>(jobType: string, work: () => Promise<T>, recordWhen: (result: T) => boolean) {
  const startedAt = Date.now();
  try {
    const result = await work();
    if (recordWhen(result)) {
      const id = await startJobRun(db, jobType);
      await finishJobRun(db, id, { status: "done", cursor: { ...result, workMs: Date.now() - startedAt } });
    }
    return result;
  } catch (error) {
    const id = await startJobRun(db, jobType).catch(() => null);
    if (id) await finishJobRun(db, id, { status: "error", errorCode: (error as Error).message }).catch(() => {});
    throw error;
  }
}

const maintenance = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.name === "aggregate") {
      // Quiet runs are not recorded; a rollup that changed something is.
      return recorded("event_aggregation", () => runAggregation(db), (r) => r.days > 0);
    }
    if (job.name === "retention") {
      return recorded(
        "retention_purge",
        async () => {
          const sitesPurged = await purgeDeletedSites(db);
          const eventsPurged = await purgeExpiredEvents(db);
          await purgeOldVisitorSalts(db);
          await pruneJobRuns(db);
          await pruneGscSyncRuns(db);
          return { sitesPurged, eventsPurged };
        },
        () => true,
      );
    }
    if (job.name === "purge-sites") {
      return recorded(
        "site_purge",
        async () => ({ sitesPurged: await purgeDeletedSites(db), accountsRemoved: await removeUnusedIntegrations() }),
        (r) => r.sitesPurged > 0 || r.accountsRemoved > 0,
      );
    }
    if (job.name === "health-dispatch") {
      await expireSnoozes(db);
      const scheduled = await scheduleDueCrawls(db);
      const crawls = await claimQueuedCrawls(db);
      await auditQueue.addBulk(crawls.map((runId) => ({ name: "crawl", data: { runId }, opts: { removeOnComplete: 50, removeOnFail: 200 } })));
      let labRuns: string[] = [];
      if (performance) {
        await scheduleDuePerformanceRuns(db);
        labRuns = await claimQueuedPerformanceRuns(db);
        await auditQueue.addBulk(labRuns.map((runId) => ({ name: "lighthouse", data: { runId }, opts: { removeOnComplete: 50, removeOnFail: 200 } })));
      }
      return { scheduled, crawls: crawls.length, labRuns: labRuns.length };
    }
    if (job.name === "alerts") {
      return recorded(
        "alert_evaluation",
        async () => {
          let fieldImports = 0;
          if (performance) {
            for (const site of await sitesDueForCrux(db)) {
              await syncCrux(db, site, performance);
              fieldImports++;
            }
          }
          const { raised, resolved } = await evaluateAlerts(db);
          await emailAlerts(raised);
          return { raised: raised.length, resolved, fieldImports };
        },
        (r) => r.raised > 0 || r.resolved > 0 || r.fieldImports > 0,
      );
    }
    if (job.name === "gsc-dispatch") {
      // Nothing is claimed here unless this worker can also run the sync.
      if (!searchConsole) return { due: 0 };
      const due = await claimDueProperties(db);
      await seoQueue.addBulk(due.map((propertyId) => ({ name: "gsc-sync", data: { propertyId }, opts: { removeOnComplete: 50, removeOnFail: 200 } })));
      return { due: due.length };
    }
  },
  // One at a time: rollups for a day never overlap inside this process. A second worker
  // instance is still safe because recomputing a day is idempotent.
  { connection: connection(), concurrency: 1 },
);
maintenance.on("failed", (job, error) => log("error", "maintenance failed", { job: job?.name, error: error.message }));

const scheduler = new Queue(MAINTENANCE_QUEUE, { connection: connection() });
await scheduler.upsertJobScheduler("aggregate", { every: AGGREGATE_EVERY_MS }, { name: "aggregate", opts: keep });
await scheduler.upsertJobScheduler("purge-sites", { every: 5 * 60_000 }, { name: "purge-sites", opts: keep });
await scheduler.upsertJobScheduler("gsc-dispatch", { every: Number(process.env.GSC_DISPATCH_EVERY_MS ?? 30_000) }, { name: "gsc-dispatch", opts: { removeOnComplete: 10, removeOnFail: 50 } });
await scheduler.upsertJobScheduler("health-dispatch", { every: Number(process.env.HEALTH_DISPATCH_EVERY_MS ?? 15_000) }, { name: "health-dispatch", opts: { removeOnComplete: 10, removeOnFail: 50 } });
await scheduler.upsertJobScheduler("alerts", { every: Number(process.env.ALERTS_EVERY_MS ?? 3_600_000) }, { name: "alerts", opts: keep });
await scheduler.upsertJobScheduler("retention", { pattern: "15 3 * * *" }, { name: "retention", opts: keep });

log("info", "worker started", { aggregateEveryMs: AGGREGATE_EVERY_MS, searchConsole: searchConsole ? "enabled" : "not configured", performance: performance ? "enabled" : "not configured" });

const shutdown = async () => {
  await Promise.allSettled([ingest.close(), maintenance.close(), seo?.close(), audit.close(), auditQueue.close(), scheduler.close(), seoQueue.close()]);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

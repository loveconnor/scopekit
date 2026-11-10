import { safeEqual } from "@scopekit/seo";
import { CRAWL_BUDGET_MS, runCrawlNow } from "@/lib/jobs";
import { claimQueuedCrawls, expireSnoozes, finishJobRun, getDb, nextQueuedCrawl, pruneJobRuns, purgeDeletedSites, purgeExpiredEvents, purgeOldVisitorSalts, runAggregation, scheduleDueCrawls, startJobRun } from "@scopekit/db";
import { evaluateAlerts } from "@scopekit/health";

// Long enough for one crawl; the other jobs finish in seconds.
export const maxDuration = 800;

/**
 * Scheduled work for deployments without the long-running worker (see apps/web/vercel.json).
 * Vercel Cron calls these with `Authorization: Bearer $CRON_SECRET`; nothing else can.
 */
const JOBS: Record<string, { type: string; run: () => Promise<Record<string, unknown>>; record: (r: Record<string, unknown>) => boolean }> = {
  aggregate: {
    type: "event_aggregation",
    run: async () => ({ ...(await runAggregation(getDb())), sitesPurged: await purgeDeletedSites(getDb()) }),
    record: (r) => Number(r.days) > 0 || Number(r.sitesPurged) > 0,
  },
  audit: {
    type: "audit_dispatch",
    run: async () => {
      const db = getDb();
      await expireSnoozes(db);
      const scheduled = await scheduleDueCrawls(db);
      // Closes runs whose function died mid-crawl, so the site can be crawled again.
      await claimQueuedCrawls(db, 15, 0);
      // One crawl per invocation keeps it inside the function's time limit.
      const runId = await nextQueuedCrawl(db);
      if (runId) await runCrawlNow(runId);
      return { scheduled, ran: runId ? 1 : 0, budgetMs: CRAWL_BUDGET_MS };
    },
    record: () => false,
  },
  alerts: {
    type: "alert_evaluation",
    run: async () => {
      const { raised, resolved } = await evaluateAlerts(getDb());
      return { raised: raised.length, resolved };
    },
    record: (r) => Number(r.raised) > 0 || Number(r.resolved) > 0,
  },
  maintenance: {
    type: "retention_purge",
    run: async () => {
      const db = getDb();
      const sitesPurged = await purgeDeletedSites(db);
      const eventsPurged = await purgeExpiredEvents(db);
      await purgeOldVisitorSalts(db);
      await pruneJobRuns(db);
      return { sitesPurged, eventsPurged };
    },
    record: () => true,
  },
};

export async function GET(request: Request, ctx: RouteContext<"/api/cron/[job]">) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(given, `Bearer ${secret}`)) return Response.json({ code: "unauthorized" }, { status: 401 });
  const { job } = await ctx.params;
  const spec = JOBS[job];
  if (!spec) return Response.json({ code: "not_found" }, { status: 404 });

  const db = getDb();
  try {
    const result = await spec.run();
    // Quiet runs are not recorded, as with the worker, so Activity lists only runs that did something.
    if (spec.record(result)) {
      const id = await startJobRun(db, spec.type);
      await finishJobRun(db, id, { status: "done", cursor: result });
    }
    return Response.json({ job, ...result });
  } catch (error) {
    const id = await startJobRun(db, spec.type).catch(() => null);
    if (id) await finishJobRun(db, id, { status: "error", errorCode: (error as Error).message }).catch(() => {});
    console.error(JSON.stringify({ level: "error", msg: "cron failed", job, error: (error as Error).message }));
    return Response.json({ code: "job_failed" }, { status: 500 });
  }
}

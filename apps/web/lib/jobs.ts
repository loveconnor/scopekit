import "server-only";
import { runCrawl } from "@scopekit/audit";
import { claimCrawl, finishJobRun, getCrawlRun, getDb, startJobRun } from "@scopekit/db";
import { alertsForCrawl } from "@scopekit/health";

/**
 * Background work on a deployment without the long-running worker. A crawl runs inside the
 * function that queued it (after the response) or inside the cron route; claiming is atomic,
 * so the two never run the same crawl.
 */

/** Seconds a crawl may take on Vercel. The function itself is allowed 800. */
export const CRAWL_BUDGET_MS = 700_000;

export async function runCrawlNow(runId: string): Promise<void> {
  const db = getDb();
  if (!(await claimCrawl(db, runId))) return;
  const run = await getCrawlRun(db, runId);
  const jobId = await startJobRun(db, run?.kind === "recheck" ? "page_recheck" : "site_crawl", run?.siteId ?? null);
  try {
    // A crawl that would outrun the function stops at the limit and is stored as partial.
    const result = await runCrawl(db, runId, { maxDurationMs: CRAWL_BUDGET_MS });
    await finishJobRun(db, jobId, { status: result.status === "error" ? "error" : "done", errorCode: result.status === "error" ? "The crawl could not run" : undefined, cursor: { ...result } });
    await alertsForCrawl(db, runId);
  } catch (error) {
    await finishJobRun(db, jobId, { status: "error", errorCode: (error as Error).message }).catch(() => {});
    console.error(JSON.stringify({ level: "error", msg: "crawl failed", runId, error: (error as Error).message }));
  }
}

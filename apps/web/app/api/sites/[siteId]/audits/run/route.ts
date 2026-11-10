import { runCrawlNow } from "@/lib/jobs";
import { after } from "next/server";
import { fail, withSite } from "@/lib/api";
import { CrawlAlreadyActiveError, queueCrawl, requestCrawlCancel, writeAuditLog } from "@scopekit/db";

// A crawl runs in this function after the response, so it gets the longest allowed duration.
export const maxDuration = 800;

/** Queues a full crawl. The worker runs it; this request returns at once. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/run">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    if (site.isDemo) fail(400, "demo_site", "Demo sites use reserved hostnames and cannot be crawled");
    try {
      const jobId = await queueCrawl(db, { siteId: site.id, kind: "full", trigger: "manual", maxPages: site.settings.maxPages });
      await writeAuditLog(db, { actorId: user.id, siteId: site.id, entity: "audit", action: "crawl_started", summary: `${site.name}: site audit started` });
      // Starts right away, after this response is sent; the cron route is the backup.
      after(() => runCrawlNow(jobId));
      return Response.json({ jobId, status: "queued" }, { status: 202 });
    } catch (error) {
      if (error instanceof CrawlAlreadyActiveError) fail(409, "crawl_active", "A crawl is already queued or running for this site");
      throw error;
    }
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/run">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    await requestCrawlCancel(db, site.id);
    return Response.json({ ok: true }, { status: 202 });
  });
}

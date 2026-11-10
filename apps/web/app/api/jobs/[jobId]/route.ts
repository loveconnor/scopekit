import { fail, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { getCrawlRun, getPerformanceRun, getSite } from "@scopekit/db";

/** State of a queued crawl or lab run, for polling after a 202. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[jobId]">) {
  return withUser(request, async ({ db }) => {
    const { jobId } = await ctx.params;
    const crawl = await getCrawlRun(db, jobId);
    const lab = crawl ? null : await getPerformanceRun(db, jobId);
    const job = crawl ?? lab;
    // The job is only visible together with its site.
    if (!job || !(await getSite(db, job.siteId, { includeDemo: env.demo }))) fail(404, "job_not_found", "No job with that ID");
    if (crawl) {
      const finished = !["queued", "running", "cancelling"].includes(crawl.status);
      return Response.json({ id: crawl.id, type: crawl.kind === "recheck" ? "page_recheck" : "site_crawl", siteId: crawl.siteId, status: crawl.status, finished, progress: { discovered: crawl.pagesDiscovered, crawled: crawl.pagesCrawled, limit: crawl.maxPages }, error: crawl.errorSummary });
    }
    return Response.json({ id: lab!.id, type: "lighthouse", siteId: lab!.siteId, status: lab!.status, finished: lab!.status === "done" || lab!.status === "error", error: lab!.error });
  });
}

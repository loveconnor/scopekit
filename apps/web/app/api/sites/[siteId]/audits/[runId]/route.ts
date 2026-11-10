import { fail, withSite } from "@/lib/api";
import { getCrawlRun } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/[runId]">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const { runId } = await ctx.params;
    const run = await getCrawlRun(db, runId);
    if (!run || run.siteId !== site.id) fail(404, "run_not_found", "No crawl with that ID");
    return Response.json({ ...run, source: "scopekit", isPartial: !run.coverageComplete });
  });
}

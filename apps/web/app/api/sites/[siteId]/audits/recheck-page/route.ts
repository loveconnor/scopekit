import { fail, readJson, withSite } from "@/lib/api";
import { urlOnSite } from "@/lib/health";
import { recheckPageSchema } from "@scopekit/contracts";
import { CrawlAlreadyActiveError, queueCrawl } from "@scopekit/db";

/** Queues a fresh look at one page. Earlier evidence is kept; the new observation is added next to it. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/recheck-page">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const { url } = await readJson(request, recheckPageSchema);
    if (site.isDemo) fail(400, "demo_site", "Demo sites cannot be crawled");
    if (!urlOnSite(site, url)) fail(422, "url_outside_site", "This URL is not on one of the site's hostnames");
    try {
      const jobId = await queueCrawl(db, { siteId: site.id, kind: "recheck", targetUrl: url, trigger: "manual", maxPages: 1 });
      return Response.json({ jobId, status: "queued" }, { status: 202 });
    } catch (error) {
      if (error instanceof CrawlAlreadyActiveError) fail(409, "crawl_active", "Wait for the running crawl to finish, then recheck");
      throw error;
    }
  });
}

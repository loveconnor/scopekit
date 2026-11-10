import { fail, readJson, withSite } from "@/lib/api";
import { PERFORMANCE_DAILY_CAP, performanceConfigured, urlOnSite } from "@/lib/health";
import { PERF_DEVICES, runPerformanceSchema } from "@scopekit/contracts";
import { countPerformanceRunsSince, queuePerformanceRun } from "@scopekit/db";

/** Queues Lighthouse lab runs for a page. Each run is one PageSpeed Insights request made by the worker. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/performance/run">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const input = await readJson(request, runPerformanceSchema);
    if (site.isDemo) fail(400, "demo_site", "Demo sites are not reachable, so there is nothing to measure");
    if (!performanceConfigured()) fail(503, "not_configured", "Performance checks are not set up on this server");
    const url = input.url ?? `${site.canonicalOrigin}/`;
    if (!urlOnSite(site, url)) fail(422, "url_outside_site", "This URL is not on one of the site's hostnames");
    const devices = input.device ? [input.device] : [...PERF_DEVICES];
    const used = await countPerformanceRunsSince(db, site.id, new Date(Date.now() - 24 * 3_600_000));
    if (used + devices.length > PERFORMANCE_DAILY_CAP) fail(429, "budget_paused", `This site has used its ${PERFORMANCE_DAILY_CAP} lab runs for the last 24 hours`);
    const jobIds = (await Promise.all(devices.map((device) => queuePerformanceRun(db, { siteId: site.id, url, device, trigger: "manual" })))).filter((id): id is string => id !== null);
    if (!jobIds.length) fail(409, "run_active", "A run for this page is already queued");
    return Response.json({ jobIds, status: "queued", remainingToday: PERFORMANCE_DAILY_CAP - used - jobIds.length }, { status: 202 });
  });
}

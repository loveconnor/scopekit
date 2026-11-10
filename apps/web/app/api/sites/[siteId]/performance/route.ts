import { searchParamsOf, withSite } from "@/lib/api";
import { PERF_DEVICES, type PerfDevice } from "@scopekit/contracts";
import { cruxSeries, performanceHistory } from "@scopekit/db";

/** Lab runs and field data, kept apart: a lab run is one synthetic load, field data is what real Chrome users saw. */
export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/performance">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const params = searchParamsOf(request);
    const device = PERF_DEVICES.includes(params.device as PerfDevice) ? (params.device as PerfDevice) : "mobile";
    const url = typeof params.url === "string" ? params.url : `${site.canonicalOrigin}/`;
    const [runs, field] = await Promise.all([performanceHistory(db, site.id, url, device, 60), cruxSeries(db, site.id, device === "mobile" ? "PHONE" : "DESKTOP")]);
    return Response.json({
      siteId: site.id,
      url,
      device,
      lab: { source: "lighthouse", runs },
      field: { source: "crux", origin: site.canonicalOrigin, status: site.settings.cruxStatus, periods: field },
    });
  });
}

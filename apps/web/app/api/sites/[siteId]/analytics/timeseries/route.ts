import { searchParamsOf, withSite } from "@/lib/api";
import { parseViewState } from "@/lib/params";
import { siteReport } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/analytics/timeseries">) {
  return withSite(request, ctx.params, async ({ site }) => {
    const { series, range, meta } = await siteReport(site, parseViewState(searchParamsOf(request)));
    return Response.json({
      siteId: site.id,
      range: { from: range.from, to: range.to, timezone: site.timezone },
      granularity: range.granularity,
      source: meta.source,
      freshThrough: meta.freshThrough,
      visitorMetricMode: meta.visitorMode,
      isPartial: meta.isPartial,
      metricDefinitionsVersion: meta.metricDefinitionsVersion,
      points: series.map((p) => ({
        bucket: p.bucket,
        pageviews: p.pageviews,
        sessions: p.sessions,
        visitorEstimate: p.visitors,
        events: p.events,
        isPartial: p.status === "provisional",
      })),
    });
  });
}

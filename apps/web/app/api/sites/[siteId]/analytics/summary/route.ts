import { searchParamsOf, withSite } from "@/lib/api";
import { parseViewState } from "@/lib/params";
import { siteReport } from "@/lib/reports";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/analytics/summary">) {
  return withSite(request, ctx.params, async ({ site }) => {
    const report = await siteReport(site, parseViewState(searchParamsOf(request)));
    const { totals, previous, range, meta } = report;
    const shape = (t: typeof totals) => ({
      pageviews: t.pageviews,
      sessions: t.sessions,
      visitorEstimate: t.visitors,
      events: t.events,
      ...(report.sessionMetricsAvailable
        ? { engagedSessions: t.engagedSessions, goalCompletions: t.conversions, convertingSessions: t.convertingSessions }
        : {}),
    });
    return Response.json({
      siteId: site.id,
      range: { from: range.from, to: range.to, timezone: site.timezone },
      source: meta.source,
      freshThrough: meta.freshThrough,
      // For multi-day ranges the visitor figure is daily estimates summed, not period-unique people.
      visitorMetricMode: meta.visitorMode,
      isPartial: meta.isPartial,
      metricDefinitionsVersion: meta.metricDefinitionsVersion,
      metrics: shape(totals),
      previous: previous ? { range: { from: range.previous.from, to: range.previous.to }, metrics: shape(previous) } : null,
    });
  });
}

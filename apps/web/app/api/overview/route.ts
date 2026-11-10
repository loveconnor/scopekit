import { searchParamsOf, withUser } from "@/lib/api";
import { parseViewState } from "@/lib/params";
import { portfolioReport } from "@/lib/reports";
import { METRIC_DEFINITIONS_VERSION } from "@scopekit/contracts";

export async function GET(request: Request) {
  return withUser(request, async () => {
    const report = await portfolioReport(parseViewState(searchParamsOf(request)));
    return Response.json({
      source: "scopekit",
      freshThrough: report.freshThrough,
      isPartial: report.range?.includesToday ?? false,
      metricDefinitionsVersion: METRIC_DEFINITIONS_VERSION,
      range: report.range ? { from: report.range.from, to: report.range.to } : null,
      totals: report.totals,
      previous: report.previous,
      // Visitors are summed per site and never deduplicated across sites.
      visitorMetric: "summed-site-visitors",
      searchClicks: { status: "not_connected" },
      criticalIssues: { status: "no_audit" },
      sites: report.sites.map((s) => ({
        id: s.site.id,
        name: s.site.name,
        hostname: s.site.primaryHostname,
        timezone: s.site.timezone,
        status: s.site.status,
        lastEventAt: s.site.lastEventAt,
        range: { from: s.range.from, to: s.range.to },
        metrics: s.hasData ? { pageviews: s.totals.pageviews, sessions: s.totals.sessions, visitorEstimate: s.totals.visitors } : null,
      })),
    });
  });
}

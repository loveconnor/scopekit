import { csvResponse, searchParamsOf, withSite } from "@/lib/api";
import { parseViewState } from "@/lib/params";
import { sourcesReport } from "@/lib/tables";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/analytics/sources">) {
  return withSite(request, ctx.params, async ({ site }) => {
    const params = searchParamsOf(request);
    const groupBy = params.group === "referrer" || params.group === "campaign" ? params.group : "source";
    const report = await sourcesReport(site, parseViewState(params), groupBy);
    if (params.format === "csv") {
      return csvResponse(
        `${site.primaryHostname}-${groupBy}-${report.range.from}-${report.range.to}.csv`,
        [groupBy, "medium", "sessions", "pageviews", "visitor_estimate", "converting_sessions"],
        report.rows.map((r) => [r.key, r.medium, r.sessions, r.pageviews, r.visitors, r.convertingSessions]),
      );
    }
    return Response.json({
      siteId: site.id,
      range: { from: report.range.from, to: report.range.to, timezone: site.timezone },
      source: "scopekit",
      // Session acquisition: the source of the first event in each session.
      attribution: "session-first-touch",
      groupBy,
      rows: report.rows,
    });
  });
}

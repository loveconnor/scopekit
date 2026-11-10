import { csvResponse, searchParamsOf, withSite } from "@/lib/api";
import { parseViewState } from "@/lib/params";
import { pagesReport } from "@/lib/tables";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/analytics/pages">) {
  return withSite(request, ctx.params, async ({ site }) => {
    const params = searchParamsOf(request);
    const csv = params.format === "csv";
    const report = await pagesReport(site, parseViewState(params), {
      search: typeof params.q === "string" ? params.q : undefined,
      sort: typeof params.sort === "string" ? params.sort : undefined,
      cursor: csv ? undefined : typeof params.cursor === "string" ? params.cursor : undefined,
      limit: csv ? 200 : 50,
    });
    if (csv) {
      return csvResponse(
        `${site.primaryHostname}-pages-${report.range.from}-${report.range.to}.csv`,
        ["path", "pageviews", "sessions", "visitor_estimate", "entries", "exits", "goal_completions"],
        report.rows.map((r) => [r.path, r.pageviews, r.sessions, r.visitors, r.entries, r.exits, r.goalCompletions]),
      );
    }
    return Response.json({
      siteId: site.id,
      range: { from: report.range.from, to: report.range.to, timezone: site.timezone },
      source: "scopekit",
      isPartial: report.range.includesToday,
      rows: report.rows,
      total: report.total,
      nextCursor: report.nextCursor,
    });
  });
}

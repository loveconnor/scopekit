import { csvResponse, withSite } from "@/lib/api";
import { metricsOf, searchTable } from "@/lib/seo";
import { seoEnvelope, seoRequest } from "@/lib/seo-api";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/queries">) {
  return withSite(request, ctx.params, async ({ site }) => {
    const { params, conn, view, range } = await seoRequest(request, site);
    const csv = params.format === "csv";
    const table = await searchTable("query", conn.active.id, range, view.compare, {
      search: typeof params.q === "string" ? params.q : undefined,
      sort: typeof params.sort === "string" ? params.sort : undefined,
      page: csv ? 1 : Number(params.p ?? 1),
      limit: csv ? 5000 : undefined,
    });
    if (csv) {
      return csvResponse(
        `${site.primaryHostname}-search-queries-${range.from}-${range.to}.csv`,
        ["query", "clicks", "impressions", "ctr", "average_position", "previous_clicks", "previous_impressions"],
        table.rows.map((r) => [r.key, r.clicks, r.impressions, metricsOf(r).ctr?.toFixed(4), metricsOf(r).position?.toFixed(2), r.previous?.clicks, r.previous?.impressions]),
      );
    }
    return Response.json({
      ...seoEnvelope(site, conn, range),
      rows: table.rows.map((r) => ({ query: r.key, clicks: r.clicks, impressions: r.impressions, ...metricsOf(r), previous: r.previous ? { clicks: r.previous.clicks, impressions: r.previous.impressions, ...metricsOf(r.previous) } : null, hasOpportunity: r.hasOpportunity })),
      total: table.total,
      page: table.page,
      pages: table.pages,
    });
  });
}

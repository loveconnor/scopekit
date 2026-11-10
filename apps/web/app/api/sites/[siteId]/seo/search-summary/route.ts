import { withSite } from "@/lib/api";
import { metricsOf, queryCoverage, searchSummary } from "@/lib/seo";
import { seoEnvelope, seoRequest } from "@/lib/seo-api";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/search-summary">) {
  return withSite(request, ctx.params, async ({ site }) => {
    const { conn, view, range } = await seoRequest(request, site);
    const summary = await searchSummary(conn.active.id, range, view.compare);
    const coverage = await queryCoverage(conn.active.id, range, summary.totals);
    const shape = (t: typeof summary.totals) => ({ clicks: t.clicks, impressions: t.impressions, ...metricsOf(t) });
    return Response.json({
      ...seoEnvelope(site, conn, range),
      totals: shape(summary.totals),
      previous: summary.previous ? { range: range.previous, ...shape(summary.previous) } : null,
      series: summary.series,
      // Clicks that came with a visible query. The remainder is withheld by Google and is not estimated.
      namedQueries: { clicks: coverage.clicks, impressions: coverage.impressions, clickShare: coverage.clickShare },
    });
  });
}

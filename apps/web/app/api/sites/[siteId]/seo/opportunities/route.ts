import { fail, searchParamsOf, withSite } from "@/lib/api";
import { isReady, loadSearchConnection } from "@/lib/seo";
import { OPPORTUNITY_CATEGORIES, OPPORTUNITY_STATUSES, type OpportunityCategory, type OpportunityStatus } from "@scopekit/contracts";
import { listOpportunities } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/opportunities">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const params = searchParamsOf(request);
    const conn = await loadSearchConnection(site.id, typeof params.property === "string" ? params.property : undefined);
    if (!isReady(conn)) fail(409, conn.state, "Search Console data is not available for this site yet");
    const status = OPPORTUNITY_STATUSES.includes(params.status as OpportunityStatus) ? [params.status as OpportunityStatus] : undefined;
    const category = OPPORTUNITY_CATEGORIES.includes(params.category as OpportunityCategory) ? (params.category as OpportunityCategory) : undefined;
    const rows = await listOpportunities(db, conn.active.id, { statuses: status, category });
    return Response.json({
      siteId: site.id,
      source: "gsc",
      property: conn.active.externalPropertyId,
      freshThrough: conn.active.finalizedThrough,
      // The score orders work. It is not a traffic estimate.
      rows: rows.map((o) => ({ id: o.id, rule: o.rule, category: o.category, subjectType: o.subjectType, subject: o.subject, status: o.status, score: o.score, evidence: o.evidence, firstSeenAt: o.firstSeenAt, lastSeenAt: o.lastSeenAt })),
    });
  });
}

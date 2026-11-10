import { fail, readJson, withSite } from "@/lib/api";
import { updateOpportunitySchema } from "@scopekit/contracts";
import { setOpportunityStatus } from "@scopekit/db";

export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/opportunities/[opportunityId]">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const { opportunityId } = await ctx.params;
    const { status } = await readJson(request, updateOpportunitySchema);
    if (!(await setOpportunityStatus(db, site.id, opportunityId, status))) fail(404, "opportunity_not_found", "No opportunity with that ID");
    return Response.json({ id: opportunityId, status });
  });
}

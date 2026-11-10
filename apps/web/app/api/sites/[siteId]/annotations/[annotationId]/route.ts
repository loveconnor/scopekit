import { fail, withSite } from "@/lib/api";
import { deleteAnnotation } from "@scopekit/db";

export async function DELETE(request: Request, ctx: RouteContext<"/api/sites/[siteId]/annotations/[annotationId]">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const { annotationId } = await ctx.params;
    if (!(await deleteAnnotation(db, site.id, annotationId))) fail(404, "annotation_not_found", "No annotation with that ID");
    return Response.json({ ok: true });
  });
}

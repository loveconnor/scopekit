import { readJson, searchParamsOf, withSite } from "@/lib/api";
import { createAnnotationSchema } from "@scopekit/contracts";
import { createAnnotation, listAnnotations } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/annotations">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const params = searchParamsOf(request);
    const range = typeof params.from === "string" && typeof params.to === "string" ? { from: params.from, to: params.to } : undefined;
    return Response.json({ siteId: site.id, rows: await listAnnotations(db, site.id, range, 200) });
  });
}

/** A dated note about something the owner changed. It marks a date; it does not claim to explain what followed. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/annotations">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const input = await readJson(request, createAnnotationSchema);
    const row = await createAnnotation(db, { siteId: site.id, date: input.date, type: input.type, title: input.title, note: input.note || null, linkedUrl: input.linkedUrl || null, commitSha: input.commitSha || null });
    return Response.json(row, { status: 201 });
  });
}

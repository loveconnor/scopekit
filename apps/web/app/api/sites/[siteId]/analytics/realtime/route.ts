import { withSite } from "@/lib/api";
import { realtimeSnapshot } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/analytics/realtime">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const snapshot = await realtimeSnapshot(db, site.id);
    return Response.json(
      { siteId: site.id, source: "scopekit", approximate: true, serverTime: new Date().toISOString(), timezone: site.timezone, ...snapshot },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

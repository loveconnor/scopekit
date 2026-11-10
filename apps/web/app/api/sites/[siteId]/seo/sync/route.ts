import { fail, withSite } from "@/lib/api";
import { listSiteProperties, requestPropertySync } from "@scopekit/db";

/** Asks the worker to sync this site's properties now. The work itself never runs in a web request. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/sync">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const properties = (await listSiteProperties(db, site.id)).filter((p) => !p.isDemo && p.enabled);
    if (!properties.length) fail(409, "not_connected", "No Search Console property is linked to this site");
    const ready = properties.filter((p) => p.connectionStatus === "connected");
    if (!ready.length) fail(409, "needs_reauth", "Reconnect the Google account before syncing");
    await Promise.all(ready.map((p) => requestPropertySync(db, p.id)));
    return Response.json({ queued: ready.length }, { status: 202 });
  });
}

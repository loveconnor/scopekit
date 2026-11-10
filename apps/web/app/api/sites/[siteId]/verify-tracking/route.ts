import { withSite } from "@/lib/api";
import { recentIngest } from "@scopekit/db";

/** Reports what the collector has received for this site in the last 10 minutes. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/verify-tracking">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const recent = await recentIngest(db, site.id, 10);
    return Response.json({
      verified: recent.events > 0,
      events: recent.events,
      botEvents: recent.botEvents,
      lastReceivedAt: recent.lastReceivedAt,
      lastPath: recent.lastPath,
      trackingEnabled: site.settings.trackingEnabled,
      hostnames: site.hostnames,
    });
  });
}

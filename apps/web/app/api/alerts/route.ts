import { searchParamsOf, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { ALERT_STATUSES, type AlertStatus } from "@scopekit/contracts";
import { countAlerts, listAlerts, listSites } from "@scopekit/db";

export async function GET(request: Request) {
  return withUser(request, async ({ db }) => {
    const params = searchParamsOf(request);
    const sites = await listSites(db, { includeDemo: env.demo });
    const siteIds = sites.map((s) => s.id);
    const status = ALERT_STATUSES.includes(params.status as AlertStatus) ? [params.status as AlertStatus] : undefined;
    const [rows, counts] = await Promise.all([listAlerts(db, { siteIds, statuses: status, limit: 200 }), countAlerts(db, siteIds)]);
    return Response.json({ source: "scopekit", counts, rows });
  });
}

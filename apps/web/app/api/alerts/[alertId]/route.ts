import { fail, readJson, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { updateAlertSchema } from "@scopekit/contracts";
import { listSites, setAlertStatus } from "@scopekit/db";

/** Acknowledge, snooze, resolve or reopen an alert. Resolved alerts stay in the history. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/alerts/[alertId]">) {
  return withUser(request, async ({ db }) => {
    const { alertId } = await ctx.params;
    const input = await readJson(request, updateAlertSchema);
    if (input.status === "snoozed" && (!input.until || input.until <= new Date().toISOString().slice(0, 10))) fail(422, "validation_failed", "Pick a future date to snooze until");
    // Alerts are only reachable through sites the session can see.
    const siteIds = (await listSites(db, { includeDemo: env.demo })).map((s) => s.id);
    const alert = await setAlertStatus(db, alertId, siteIds, input);
    if (!alert) fail(404, "alert_not_found", "No alert with that ID");
    return Response.json({ id: alert.id, status: alert.status, snoozedUntil: alert.snoozedUntil });
  });
}

import { searchParamsOf, withSite } from "@/lib/api";
import { parseViewState } from "@/lib/params";
import { rangeFor } from "@/lib/reports";
import { eventTable, goalTotals, listGoals } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/analytics/events">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const range = await rangeFor(parseViewState(searchParamsOf(request)), site.timezone);
    const [events, goals, totals] = await Promise.all([
      eventTable(db, site.id, range.from, range.to),
      listGoals(db, site.id),
      goalTotals(db, site.id, range.from, range.to),
    ]);
    const byGoal = new Map(totals.map((t) => [t.goalId, t]));
    return Response.json({
      siteId: site.id,
      range: { from: range.from, to: range.to, timezone: site.timezone },
      source: "scopekit",
      events,
      goals: goals.map((goal) => ({
        id: goal.id,
        name: goal.name,
        enabled: goal.enabled,
        rules: goal.matchingRules,
        completions: byGoal.get(goal.id)?.completions ?? 0,
        convertingSessions: byGoal.get(goal.id)?.convertingSessions ?? 0,
      })),
    });
  });
}

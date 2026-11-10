import { readJson, withSite } from "@/lib/api";
import { createGoalSchema } from "@scopekit/contracts";
import { listGoals, markDirtyRetainedDays, schema, writeAuditLog } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/goals">) {
  return withSite(request, ctx.params, async ({ db, site }) => Response.json({ goals: await listGoals(db, site.id) }));
}

export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/goals">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const input = await readJson(request, createGoalSchema);
    const [goal] = await db
      .insert(schema.goals)
      .values({ siteId: site.id, name: input.name, type: input.rules.type, matchingRules: input.rules })
      .returning();
    // Backfill from retained raw events; the next aggregation run fills in history.
    await markDirtyRetainedDays(db, site.id);
    await writeAuditLog(db, { actorId: user.id, siteId: site.id, entity: "goal", action: "created", summary: `${site.name}: added goal ${input.name}` });
    return Response.json({ goal, backfill: { retainedDays: site.settings.retentionDays } }, { status: 201 });
  });
}

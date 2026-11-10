import { fail, readJson, withSite } from "@/lib/api";
import { updateGoalSchema } from "@scopekit/contracts";
import { markDirtyRetainedDays, schema, writeAuditLog } from "@scopekit/db";
import { and, eq, sql } from "drizzle-orm";

type Ctx = RouteContext<"/api/sites/[siteId]/goals/[goalId]">;
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

export async function PATCH(request: Request, ctx: Ctx) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const { goalId } = await ctx.params;
    if (!isUuid(goalId)) fail(404, "goal_not_found", "No goal with that ID");
    const patch = await readJson(request, updateGoalSchema);
    const [goal] = await db
      .update(schema.goals)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.rules !== undefined ? { matchingRules: patch.rules, type: patch.rules.type } : {}),
        version: sql`${schema.goals.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.goals.id, goalId), eq(schema.goals.siteId, site.id)))
      .returning();
    if (!goal) fail(404, "goal_not_found", "No goal with that ID");
    await markDirtyRetainedDays(db, site.id);
    await writeAuditLog(db, { actorId: user.id, siteId: site.id, entity: "goal", action: "updated", summary: `${site.name}: updated goal ${goal.name}` });
    return Response.json({ goal });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const { goalId } = await ctx.params;
    if (!isUuid(goalId)) fail(404, "goal_not_found", "No goal with that ID");
    const [goal] = await db
      .delete(schema.goals)
      .where(and(eq(schema.goals.id, goalId), eq(schema.goals.siteId, site.id)))
      .returning();
    if (!goal) fail(404, "goal_not_found", "No goal with that ID");
    await markDirtyRetainedDays(db, site.id);
    await writeAuditLog(db, { actorId: user.id, siteId: site.id, entity: "goal", action: "deleted", summary: `${site.name}: deleted goal ${goal.name}` });
    return Response.json({ ok: true });
  });
}

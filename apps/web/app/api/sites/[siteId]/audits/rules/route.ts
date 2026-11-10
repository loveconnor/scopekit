import { fail, readJson, withSite } from "@/lib/api";
import { RULE_BY_ID } from "@scopekit/audit";
import { updateAuditRuleSchema } from "@scopekit/contracts";
import { saveRuleSetting, writeAuditLog } from "@scopekit/db";

/** Switches a rule off for the site, or changes how severe it is here. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/rules">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const input = await readJson(request, updateAuditRuleSchema);
    const rule = RULE_BY_ID.get(input.ruleId);
    if (!rule) fail(404, "rule_not_found", "No audit rule with that ID");
    await saveRuleSetting(db, site.id, input.ruleId, { enabled: input.enabled, severity: input.severity });
    await writeAuditLog(db, {
      actorId: user.id,
      siteId: site.id,
      entity: "audit",
      action: "rule_changed",
      summary: `${site.name}: audit rule "${rule.title}" ${input.enabled === false ? "switched off" : input.enabled ? "switched on" : `set to ${input.severity ?? "its default severity"}`}`,
    });
    return Response.json({ ok: true });
  });
}

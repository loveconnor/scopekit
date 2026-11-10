import { readJson, withSite } from "@/lib/api";
import { updateAlertRuleSchema } from "@scopekit/contracts";
import { saveAlertRule } from "@scopekit/db";

export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]/alert-rules">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const input = await readJson(request, updateAlertRuleSchema);
    await saveAlertRule(db, site.id, input.type, { enabled: input.enabled, email: input.email });
    return Response.json({ ok: true });
  });
}

import { fail, readJson, withSite } from "@/lib/api";
import { updateIssueSchema } from "@scopekit/contracts";
import { setIssueState } from "@scopekit/db";

/** Ignore, snooze or reopen one issue. Resolving is left to the crawler: only a crawl can show a check passing. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/issues/[issueId]">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const { issueId } = await ctx.params;
    const input = await readJson(request, updateIssueSchema);
    if (input.state === "snoozed" && (!input.until || input.until <= new Date().toISOString().slice(0, 10))) fail(422, "validation_failed", "Pick a future date to snooze until");
    const issue = await setIssueState(db, site.id, issueId, input);
    if (!issue) fail(404, "issue_not_found", "No issue with that ID");
    return Response.json({ id: issue.id, state: issue.state, ignoredUntil: issue.ignoredUntil });
  });
}

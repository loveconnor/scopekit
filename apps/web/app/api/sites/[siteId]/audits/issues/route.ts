import { csvResponse, searchParamsOf, withSite } from "@/lib/api";
import { loadAuditState, ruleTitle } from "@/lib/health";
import { ISSUE_STATES, SEVERITIES, type IssueState, type Severity } from "@scopekit/contracts";
import { issueGroups, listIssues } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/issues">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const params = searchParamsOf(request);
    const state = await loadAuditState(site.id);
    const filter = {
      state: ISSUE_STATES.includes(params.state as IssueState) ? (params.state as IssueState) : ("open" as const),
      severity: SEVERITIES.includes(params.severity as Severity) ? (params.severity as Severity) : undefined,
      pathPrefix: typeof params.path === "string" ? params.path : undefined,
    };
    const envelope = { siteId: site.id, source: "scopekit", crawl: state.latestWithPages?.id ?? null, isPartial: !(state.latestWithPages?.coverageComplete ?? false) };
    if (typeof params.rule === "string") {
      const csv = params.format === "csv";
      const { rows, total } = await listIssues(db, site.id, params.rule, filter, csv ? 5000 : 100, 0);
      if (csv) {
        return csvResponse(`${site.primaryHostname}-${params.rule.toLowerCase()}.csv`, ["rule", "url", "severity", "state", "first_seen", "last_seen", "evidence"], rows.map((i) => [i.ruleId, i.url, i.severity, i.state, i.firstSeenAt.toISOString(), i.lastSeenAt.toISOString(), JSON.stringify(i.details.evidence)]));
      }
      return Response.json({ ...envelope, rule: params.rule, total, rows });
    }
    const groups = await issueGroups(db, site.id, filter, state.latestWithPages?.id ?? null);
    return Response.json({ ...envelope, groups: groups.map((g) => ({ ...g, title: ruleTitle(g.ruleId) })) });
  });
}

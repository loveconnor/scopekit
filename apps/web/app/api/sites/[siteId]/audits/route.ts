import { withSite } from "@/lib/api";
import { loadAuditState } from "@/lib/health";
import { listFullCrawls } from "@scopekit/db";

const shape = (run: Awaited<ReturnType<typeof listFullCrawls>>[number]) => ({
  id: run.id,
  status: run.status,
  trigger: run.trigger,
  queuedAt: run.queuedAt,
  finishedAt: run.finishedAt,
  pagesDiscovered: run.pagesDiscovered,
  pagesCrawled: run.pagesCrawled,
  coverageComplete: run.coverageComplete,
  errorSummary: run.errorSummary,
  summary: run.summary,
});

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const [state, runs] = await Promise.all([loadAuditState(site.id), listFullCrawls(db, site.id, 20)]);
    return Response.json({ siteId: site.id, source: "scopekit", health: state.health, openIssues: state.open, active: state.active ? shape(state.active) : null, runs: runs.map(shape) });
  });
}

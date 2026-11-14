import { FirstRun } from "@/components/scopekit/onboarding";
import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelSkeleton } from "@/components/scopekit/panel";
import { SitesTable, type SiteRow } from "@/components/scopekit/sites-table";
import { siteStatus } from "@/components/scopekit/status";
import { Button } from "@/components/ui/button";
import { computeChange, formatRelative } from "@/lib/format";
import { parseViewState } from "@/lib/params";
import { portfolioReport, requestTime } from "@/lib/reports";
import { portfolioAudit } from "@/lib/health";
import { portfolioSearch } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Websites" };

async function SitesContent() {
  const view = parseViewState({ range: "30d" });
  const report = await portfolioReport(view);
  const now = requestTime();
  if (report.sites.length === 0) return <FirstRun />;
  const siteIds = report.sites.map((s) => s.site.id);
  const [search, audit] = await Promise.all([portfolioSearch(siteIds, view), portfolioAudit(siteIds)]);
  const rows: SiteRow[] = report.sites.map((s) => {
    const change = s.hasData ? computeChange(s.totals.pageviews, s.previous?.pageviews) : null;
    return {
      id: s.site.id,
      name: s.site.name,
      hostname: s.site.primaryHostname,
      isDemo: s.site.isDemo,
      visitors: s.hasData ? s.totals.visitors : null,
      pageviews: s.hasData ? s.totals.pageviews : null,
      sessions: s.hasData ? s.totals.sessions : null,
      searchClicks: search.bySite.get(s.site.id)?.clicks ?? null,
      audit: audit.bySite.get(s.site.id)?.health ?? "not_run",
      changeText: change?.text ?? null,
      changeDirection: change?.direction ?? null,
      status: siteStatus(s.site, now),
      lastActivity: formatRelative(s.site.lastEventAt, now),
      lastActivityAt: s.site.lastEventAt ? new Date(s.site.lastEventAt).getTime() : 0,
    };
  });
  return (
    <Panel className="sk-enter overflow-hidden">
      <SitesTable rows={rows} />
    </Panel>
  );
}

export default function SitesPage() {
  return (
    <>
      <PageHeader
        title="Websites"
        subtitle="Last 30 days"
        actions={
          <Button size="sm" render={<Link href="/sites/new" />}>
            Add website
          </Button>
        }
      />
      <Suspense fallback={<PanelSkeleton height={200} />}>
        <SitesContent />
      </Suspense>
    </>
  );
}

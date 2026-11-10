import { Kpi, KpiRow, MetricLabel } from "@/components/scopekit/kpi";
import { FirstRun } from "@/components/scopekit/onboarding";
import { PageHeader } from "@/components/scopekit/page-header";
import { KpiSkeletonRow, Panel, PanelEmpty, PanelHeader, PanelSkeleton } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { RangeControl } from "@/components/scopekit/range-control";
import { SitesTable, type SiteRow } from "@/components/scopekit/sites-table";
import { siteStatus } from "@/components/scopekit/status";
import { TrendChart, type TrendRow, type TrendSeries } from "@/components/scopekit/trend-chart";
import { Button } from "@/components/ui/button";
import { computeChange, formatDateTime, formatDay, formatDayLong, formatDayRange, formatRelative } from "@/lib/format";
import { parseViewState, type SearchParams } from "@/lib/params";
import { portfolioReport, requestTime } from "@/lib/reports";
import { portfolioAudit } from "@/lib/health";
import { portfolioSearch } from "@/lib/seo";
import { getDb, listAlerts, listAuditLogs } from "@scopekit/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Overview" };

// Without hues, sites are told apart by ink for the busiest, then gray, then dashes.
const SERIES_STYLES = [
  { light: "#0f0f0f", dark: "#f5f5f5" },
  { light: "#8a8a8a", dark: "#8a8a8a" },
  { light: "#8a8a8a", dark: "#8a8a8a", dashed: true },
  { light: "#c2c2c2", dark: "#555555" },
  { light: "#c2c2c2", dark: "#555555", dashed: true },
];

async function OverviewContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const view = parseViewState(await searchParams);
  const report = await portfolioReport(view);
  const now = requestTime();

  if (report.sites.length === 0 || !report.range) {
    return (
      <>
        <PageHeader title="All websites" subtitle="Your websites at a glance" />
        <FirstRun />
      </>
    );
  }

  const { range, totals, previous } = report;
  const siteIds = report.sites.map((s) => s.site.id);
  const [search, audit, openAlerts] = await Promise.all([portfolioSearch(siteIds, view), portfolioAudit(siteIds), listAlerts(getDb(), { siteIds, statuses: ["open"], limit: 5 })]);
  const comparedTo = `vs previous ${range.days === 1 ? "day" : `${range.days} days`}`;
  const through = !report.freshThrough
    ? "no events yet"
    : range.includesToday
      ? `through ${formatDateTime(report.freshThrough, report.sites[0]!.site.timezone)}`
      : `through ${formatDay(range.to)}`;
  const anyData = report.sites.some((s) => s.hasData);

  // One chart, one line per site. The busiest site leads; the rest stay quiet.
  const ranked = [...report.sites].sort((a, b) => b.totals.pageviews - a.totals.pageviews);
  const charted = ranked.filter((s) => s.hasData).slice(0, 5);
  const series: TrendSeries[] = charted.map((s, index) => ({
    key: `s${index}`,
    label: s.site.name,
    ...SERIES_STYLES[index]!,
    emphasis: index === 0,
  }));
  const rows: TrendRow[] = report.days.map((day) => {
    const row: TrendRow = { label: formatDay(day), longLabel: formatDayLong(day), status: range.includesToday && day === range.to ? "provisional" : undefined };
    charted.forEach((s, index) => {
      row[`s${index}`] = s.series.find((p) => p.bucket === day)?.pageviews ?? 0;
    });
    return row;
  });

  const tableRows: SiteRow[] = report.sites.map((s) => {
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

  const alertItems = openAlerts.map((alert) => ({ id: alert.id, title: alert.headline, body: alert.severity === "critical" ? "Critical alert" : "Alert", href: "/alerts", rank: alert.severity === "critical" ? -2 : -1 }));
  const alerted = new Set(openAlerts.filter((a) => a.type === "tracking_stopped" || a.type === "integration_disconnected").map((a) => `${a.siteId}:${a.type}`));
  const attention = report.sites
    .map((s) => {
      const status = siteStatus(s.site, now);
      if (status === "pending_setup" || status === "never_received") {
        return { id: s.site.id, title: `${s.site.name} has not sent an event`, body: "Install the snippet, then verify tracking", href: `/sites/${s.site.id}/settings#install`, rank: 1 };
      }
      if (status === "stale" && !alerted.has(`${s.site.id}:tracking_stopped`)) {
        return { id: s.site.id, title: `${s.site.name} stopped sending events`, body: `Last event ${formatRelative(s.site.lastEventAt, now).toLowerCase()}`, href: `/sites/${s.site.id}/settings#install`, rank: 0 };
      }
      if (status === "disabled") {
        return { id: s.site.id, title: `Tracking is off for ${s.site.name}`, body: "Turn it back on in site settings", href: `/sites/${s.site.id}/settings`, rank: 2 };
      }
      return null;
    })
    .concat(alertItems)
    .concat(
      search.needsReauth.filter(({ siteId }) => !alerted.has(`${siteId}:integration_disconnected`)).map(({ siteId }) => {
        const name = report.sites.find((s) => s.site.id === siteId)?.site.name ?? "A website";
        return { id: `${siteId}-gsc`, title: `Search Console needs reconnecting for ${name}`, body: "Google access was revoked or expired. Stored data is kept", href: `/sites/${siteId}/settings/search-console`, rank: 0 };
      }),
    )
    .filter((item) => item !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);

  const activity = await listAuditLogs(getDb(), { limit: 8 });
  const displayZone = report.sites[0]!.site.timezone;

  return (
    <>
      <PageHeader
        title="All websites"
        subtitle={`${formatDayRange(range.from, range.to)} · each site in its own timezone`}
        actions={
          <>
            <RangeControl preset={range.preset} from={range.from} to={range.to} compare={view.compare} allowHourly={false} />
            <Button size="sm" render={<Link href="/sites/new" />}>
              Add website
            </Button>
          </>
        }
      />

      <div className="sk-enter flex flex-col gap-4">
        <KpiRow>
          <Kpi
            label={<MetricLabel metric="pageviews" />}
            value={anyData ? totals.pageviews : null}
            unavailable={{ text: "No data yet", reason: "No site has sent a pageview in this range" }}
            change={view.compare ? computeChange(totals.pageviews, previous?.pageviews) : undefined}
            delta={previous ? totals.pageviews - previous.pageviews : null}
            comparedTo={view.compare ? comparedTo : undefined}
            source="scopekit"
            sourceDetail={through}
          />
          <Kpi
            label={<MetricLabel metric="summedSiteVisitors" />}
            value={anyData ? totals.summedSiteVisitors : null}
            unavailable={{
              text: anyData ? "Not available" : "No data yet",
              reason: anyData ? "Every site runs in strict privacy mode" : "No site has sent a pageview in this range",
            }}
            change={view.compare ? computeChange(totals.summedSiteVisitors, previous?.summedSiteVisitors) : undefined}
            delta={previous?.summedSiteVisitors != null && totals.summedSiteVisitors != null ? totals.summedSiteVisitors - previous.summedSiteVisitors : null}
            comparedTo={view.compare ? comparedTo : undefined}
            source="scopekit"
            sourceDetail="summed estimates"
          />
          <Kpi
            label="Search clicks"
            value={search.clicks}
            unavailable={{ text: "Not connected", reason: "No site has a Search Console property with data yet" }}
            change={view.compare ? computeChange(search.clicks, search.previousClicks) : undefined}
            delta={search.clicks !== null && search.previousClicks !== null ? search.clicks - search.previousClicks : null}
            comparedTo={view.compare && search.clicks !== null ? "vs previous finalized period" : undefined}
            source="gsc"
            sourceDetail={
              search.through
                ? `${search.bySite.size} of ${report.sites.length} ${report.sites.length === 1 ? "site" : "sites"} · through ${formatDay(search.through)}`
                : "not linked"
            }
          />
          <Kpi
            label="Critical issues"
            value={audit.critical}
            unavailable={{ text: "No audit yet", reason: "No site has been crawled" }}
            note={audit.critical === null ? undefined : audit.critical === 0 ? "None open in audited sites" : "Open across audited sites"}
            upIsGood={false}
            source="scopekit"
            sourceDetail={`crawler · ${audit.bySite.size} of ${report.sites.length} ${report.sites.length === 1 ? "site" : "sites"} audited`}
          />
        </KpiRow>

        <Panel>
          <PanelHeader
            title="Pageviews by website"
            meta={<Provenance source="scopekit" detail={through} />}
          />
          {anyData ? (
            <div className="pb-4">
              <TrendChart
                rows={rows}
                series={series}
                height={320}
                ariaLabel={`Daily pageviews per website, ${formatDayRange(range.from, range.to)}`}
              />
            </div>
          ) : (
            <PanelEmpty title="No pageviews in this range">
              Sites appear here once their snippet reports traffic. A site with no events is not the same as a site with zero visitors
            </PanelEmpty>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Websites"
            description={`${report.sites.length} ${report.sites.length === 1 ? "site" : "sites"}. Visitors are per-site estimates`}
          />
          <SitesTable rows={tableRows} />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Needs attention" />
            {attention.length ? (
              <ul className="px-3 pb-3">
                {attention.map((item) => (
                  <li key={`${item.id}-${item.rank}`}>
                    <Link href={item.href} className="block rounded-md px-2 py-2 transition-colors duration-150 ease-out hover:bg-raised">
                      <span className="block text-[13px] leading-5 text-ink">{item.title}</span>
                      <span className="block text-[12px] leading-4 text-ink-3">{item.body}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty title="Nothing needs attention">No open alerts, and every site that has been set up is sending events</PanelEmpty>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Recent activity" action={<Link href="/activity" className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">View all</Link>} />
            {activity.length ? (
              <ul className="px-5 pb-4">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
                    <span className="min-w-0 truncate text-[13px] leading-5 text-ink">{entry.summary}</span>
                    <span className="shrink-0 font-mono text-[11px] leading-4 text-ink-3">{formatDateTime(entry.at, displayZone)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty title="No activity yet">Changes to sites, goals and settings are listed here</PanelEmpty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function OverviewFallback() {
  return (
    <>
      <PageHeader title="All websites" subtitle="Your websites at a glance" />
      <div className="flex flex-col gap-4">
        <KpiSkeletonRow />
        <PanelSkeleton height={320} />
        <PanelSkeleton height={160} />
      </div>
    </>
  );
}

export default function OverviewPage({ searchParams }: PageProps<"/overview">) {
  return (
    <Suspense fallback={<OverviewFallback />}>
      <OverviewContent searchParams={searchParams} />
    </Suspense>
  );
}

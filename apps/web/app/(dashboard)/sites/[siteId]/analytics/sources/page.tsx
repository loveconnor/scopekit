import { addFilterHref, FilterChips } from "@/components/scopekit/filter-chips";
import { MetricLabel } from "@/components/scopekit/kpi";
import { Panel, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { RawEventsNote, ReportFallback, SiteReportHeader } from "@/components/scopekit/site-header";
import { Button } from "@/components/ui/button";
import { formatNumber, formatPercent } from "@/lib/format";
import { viewQuery, withParams, type SearchParams } from "@/lib/params";
import { loadSiteView } from "@/lib/site-view";
import { sourcesReport } from "@/lib/tables";
import { cn } from "@/lib/utils";
import { DIRECT_SOURCE } from "@scopekit/analytics";
import type { SourceGrouping } from "@scopekit/db";
import { Download } from "honestui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Sources" };

const GROUPS: { key: SourceGrouping; label: string; column: string; empty: string }[] = [
  { key: "source", label: "Source / medium", column: "Source", empty: "No sessions in this range" },
  { key: "referrer", label: "Referrers", column: "Referring domain", empty: "No session arrived with an external referrer" },
  { key: "campaign", label: "Campaigns", column: "Campaign", empty: "No session arrived with a utm_campaign" },
];

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, params: sp, view, base } = await loadSiteView(params, searchParams);
  const pathname = `${base}/analytics/sources`;
  const group = GROUPS.find((g) => g.key === sp.group) ?? GROUPS[0]!;
  const report = await sourcesReport(site, view, group.key);
  const { range } = report;
  const exportQuery = new URLSearchParams(viewQuery(sp).slice(1));
  exportQuery.set("format", "csv");
  exportQuery.set("group", group.key);
  const filterDimension = group.key === "source" ? "source" : group.key;
  const baseParams = Object.fromEntries(new URLSearchParams(viewQuery(sp).slice(1)));

  return (
    <>
      <SiteReportHeader
        title="Sources"
        range={range}
        compare={view.compare}
        actions={
          <Button variant="outline" size="sm" render={<a href={`/api/sites/${site.id}/analytics/sources?${exportQuery}`} download />}>
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            Export CSV
          </Button>
        }
      />
      <FilterChips pathname={pathname} params={sp} view={view} />
      <Panel className="sk-enter">
        <PanelHeader
          title="Where sessions started"
          
        />
        <nav aria-label="Group sources by" className="flex gap-1 px-5 pb-3">
          {GROUPS.map((g) => (
            <Link
              key={g.key}
              href={withParams(pathname, sp, { group: g.key === "source" ? null : g.key })}
              aria-current={g.key === group.key ? "page" : undefined}
              scroll={false}
              className={cn(
                "flex h-8 items-center rounded-md px-2.5 text-[13px] transition-colors duration-150 ease-out",
                g.key === group.key ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised hover:text-ink",
              )}
            >
              {g.label}
            </Link>
          ))}
        </nav>
        {report.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-line text-[12px] text-ink-3">
                  <th scope="col" className="h-10 pl-5 text-left font-normal">{group.column}</th>
                  {group.key === "source" ? <th scope="col" className="h-10 px-3 text-left font-normal">Medium</th> : null}
                  <th scope="col" className="h-10 px-3 text-right font-normal"><MetricLabel metric="sessions" /></th>
                  <th scope="col" className="h-10 px-3 text-right font-normal">Pageviews</th>
                  <th scope="col" className="h-10 px-3 text-right font-normal"><MetricLabel metric="visitors" /></th>
                  {!report.fromRawEvents ? (
                    <>
                      <th scope="col" className="h-10 px-3 text-right font-normal whitespace-nowrap">Converting sessions</th>
                      <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal whitespace-nowrap"><MetricLabel metric="conversionRate" /></th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={`${row.key}/${row.medium}`} className="border-b border-line transition-colors duration-150 ease-out last:border-0 hover:bg-raised">
                    <th scope="row" className="h-11 pl-5 text-left font-normal">
                      <Link
                        href={addFilterHref(`${base}/analytics`, baseParams, filterDimension, row.key)}
                        className="rounded-sm text-ink"
                        title="Open traffic for this source"
                      >
                        {row.key === DIRECT_SOURCE ? "Direct / unknown" : row.key}
                      </Link>
                    </th>
                    {group.key === "source" ? <td className="h-11 px-3 text-ink-2">{row.key === DIRECT_SOURCE ? "–" : row.medium}</td> : null}
                    <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(row.sessions)}</td>
                    <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(row.pageviews)}</td>
                    <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(row.visitors)}</td>
                    {!report.fromRawEvents ? (
                      <>
                        <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(row.convertingSessions)}</td>
                        <td className="tnum h-11 pr-5 pl-3 text-right text-ink-2">
                          {row.sessions ? formatPercent((row.convertingSessions ?? 0) / row.sessions) : "–"}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelEmpty title={group.empty} />
        )}
        {report.fromRawEvents ? (
          <div className="border-t border-line px-5 py-3">
            <RawEventsNote retentionDays={site.settings.retentionDays} truncated={false} filtered={view.hasFilters} />
          </div>
        ) : null}
      </Panel>
    </>
  );
}

export default function SourcesPage({ params, searchParams }: PageProps<"/sites/[siteId]/analytics/sources">) {
  return (
    <Suspense fallback={<ReportFallback title="Sources" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

import { BarList } from "@/components/scopekit/bar-list";
import { addFilterHref, FilterChips, filterValueLabel } from "@/components/scopekit/filter-chips";
import { Kpi, KpiRow, MetricLabel } from "@/components/scopekit/kpi";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { RawEventsNote, ReportFallback, SiteReportHeader } from "@/components/scopekit/site-header";
import { change, reportLabels, trendRows } from "@/components/scopekit/site-report";
import { TrendChart } from "@/components/scopekit/trend-chart";
import { formatDay, formatPercent, formatRatio } from "@/lib/format";
import { getDb, listAnnotations } from "@scopekit/db";
import type { SearchParams } from "@/lib/params";
import { siteReport } from "@/lib/reports";
import { loadSiteView, SERIES } from "@/lib/site-view";
import { breakdownReport } from "@/lib/tables";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Traffic" };

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, params: sp, view, base } = await loadSiteView(params, searchParams);
  const pathname = `${base}/analytics`;
  const [report, countries, devices, browsers] = await Promise.all([
    siteReport(site, view),
    breakdownReport(site, view, "country"),
    breakdownReport(site, view, "device"),
    breakdownReport(site, view, "browser"),
  ]);
  const { totals, previous, range, meta } = report;
  const annotations = await listAnnotations(getDb(), site.id, { from: range.from, to: range.to }, 8);
  const { rangeLabel, comparedTo, hourly } = reportLabels(report, site.timezone);
  const compared = view.compare ? comparedTo : undefined;
  const sessionReason = "Needs whole sessions; remove filters or use a daily range";

  const breakdowns = [
    { title: "Countries", dimension: "country" as const, rows: countries, note: "From network metadata. Unknown when it is unavailable" },
    { title: "Devices", dimension: "device" as const, rows: devices, note: "Device class from the user agent" },
    { title: "Browsers", dimension: "browser" as const, rows: browsers, note: "Browser family from the user agent" },
  ];

  return (
    <>
      <SiteReportHeader title="Traffic" range={range} compare={view.compare} />
      <FilterChips pathname={pathname} params={sp} view={view} />
      <div className="sk-enter flex flex-col gap-4">
        <KpiRow columns={6}>
          <Kpi
            label={<MetricLabel metric="visitors" />}
            value={totals.visitors}
            unavailable={{ text: "Not available", reason: "Strict mode does not estimate visitors" }}
            change={view.compare ? change(totals.visitors, previous?.visitors) : undefined}
            comparedTo={compared}
            source="scopekit"
            sourceDetail={meta.mixedVisitorModes ? "privacy mode changed in range" : null}
          />
          <Kpi label={<MetricLabel metric="pageviews" />} value={totals.pageviews} change={view.compare ? change(totals.pageviews, previous?.pageviews) : undefined} comparedTo={compared} source="scopekit" />
          <Kpi label={<MetricLabel metric="sessions" />} value={totals.sessions} change={view.compare ? change(totals.sessions, previous?.sessions) : undefined} comparedTo={compared} source="scopekit" />
          <Kpi
            label={<MetricLabel metric="pagesPerSession" />}
            value={totals.sessions ? formatRatio(totals.pageviews, totals.sessions) : null}
            unavailable={{ text: "No sessions", reason: "Nothing to divide by in this range" }}
            source="scopekit"
            
          />
          <Kpi
            label={<MetricLabel metric="engagedSessions" />}
            value={report.sessionMetricsAvailable ? totals.engagedSessions : null}
            unavailable={{ text: "Not available", reason: sessionReason }}
            change={view.compare && report.sessionMetricsAvailable ? change(totals.engagedSessions, previous?.engagedSessions) : undefined}
            comparedTo={compared}
            source="scopekit"
            sourceDetail={report.sessionMetricsAvailable && totals.sessions ? `${formatPercent(totals.engagedSessions / totals.sessions, 0)} of sessions` : null}
          />
          <Kpi
            label={<MetricLabel metric="conversionRate" />}
            value={report.sessionMetricsAvailable && totals.sessions ? formatPercent(totals.convertingSessions / totals.sessions) : null}
            unavailable={{ text: "Not available", reason: totals.sessions ? sessionReason : "No sessions in this range" }}
            source="scopekit"
            
          />
        </KpiRow>

        <Panel>
          <PanelHeader
            title={hourly ? "Traffic by hour" : "Traffic by day"}
            
          />
          <div className="pb-4">
            <TrendChart
              rows={trendRows(report, site.timezone)}
              series={totals.visitors === null ? [SERIES.pageviews, SERIES.sessions] : [SERIES.pageviews, SERIES.sessions, SERIES.visitors]}
              height={320}
              ariaLabel={`Pageviews, sessions and estimated visitors for ${site.name}, ${rangeLabel}`}
            />
          </div>
          {annotations.length ? (
            <div className="border-t border-line px-5 py-3">
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {[...annotations].reverse().map((a) => (
                  <li key={a.id} className="text-[12px] leading-5 text-ink-2">
                    <span className="font-mono text-[11px] text-ink-3">{formatDay(a.date)}</span> {a.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {meta.fromRawEvents ? (
            <div className="border-t border-line px-5 py-3">
              <RawEventsNote retentionDays={site.settings.retentionDays} truncated={meta.truncatedByRetention} filtered={view.hasFilters} />
            </div>
          ) : null}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-3">
          {breakdowns.map((breakdown) => (
            <Panel key={breakdown.dimension}>
              <PanelHeader title={breakdown.title} />
              {breakdown.rows.length ? (
                <PanelBody>
                  <BarList
                    valueLabel="pageviews"
                    items={breakdown.rows.map((row) => ({
                      key: row.key,
                      label: filterValueLabel(breakdown.dimension, row.key),
                      value: row.pageviews,
                      href: addFilterHref(pathname, sp, breakdown.dimension, row.key),
                    }))}
                  />
                  <p className="mt-3 text-[12px] leading-4 text-ink-3">{breakdown.note}</p>
                </PanelBody>
              ) : (
                <PanelEmpty title="No pageviews in this range" />
              )}
            </Panel>
          ))}
        </div>
      </div>
    </>
  );
}

export default function TrafficPage({ params, searchParams }: PageProps<"/sites/[siteId]/analytics">) {
  return (
    <Suspense fallback={<ReportFallback title="Traffic" kpis={6} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

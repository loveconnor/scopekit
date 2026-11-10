import { BarList } from "@/components/scopekit/bar-list";
import { Kpi, KpiRow } from "@/components/scopekit/kpi";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { comparedLabel, ConnectionNotice, LinkTabs, SearchGate, SeoHeader, throughLabel } from "@/components/scopekit/seo";
import { ReportFallback } from "@/components/scopekit/site-header";
import { TrendChart, type TrendRow, type TrendSeries } from "@/components/scopekit/trend-chart";
import { computeChange, countryName, deviceLabel, formatDay, formatDayLong, formatDayRange, formatNumber, formatPercent, formatPosition, pointChange, positionChange } from "@/lib/format";
import { viewQuery, withParams, type SearchParams } from "@/lib/params";
import { isReady, loadSeoView, metricsOf, queryCoverage, searchSummary, searchTable, SEARCH_METRICS, type SearchMetric, type SearchPoint } from "@/lib/seo";
import { getDb, gscSegments } from "@scopekit/db";
import { alpha2Of } from "@scopekit/seo";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Search performance" };

const METRICS: Record<SearchMetric, { label: string; series: string; note: string }> = {
  clicks: { label: "Clicks", series: "Clicks", note: "Clicks from Google Search results to the property" },
  impressions: { label: "Impressions", series: "Impressions", note: "Times a result from the property was shown" },
  ctr: { label: "CTR", series: "CTR, %", note: "Each day's clicks over its impressions. Days without impressions have no CTR" },
  position: { label: "Average position", series: "Average position", note: "Impression-weighted. Lower is better: position 1 is the top result. It is an average, not a live rank" },
};
const INK = { light: "#0f0f0f", dark: "#f5f5f5" };
const QUIET = { light: "#b0b0b0", dark: "#5c5c5c" };

const valueOf = (point: SearchPoint, metric: SearchMetric): number | null =>
  metric === "ctr" ? (point.ctr === null ? null : Number((point.ctr * 100).toFixed(2))) : metric === "position" ? (point.position === null ? null : Number(point.position.toFixed(1))) : point[metric];

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, sp, view, conn, range, base } = await loadSeoView(params, searchParams);
  const pathname = `${base}/seo/search`;
  if (!isReady(conn) || !range) {
    return (
      <>
        <SeoHeader title="Search performance" site={site} conn={conn} range={null} compare={view.compare} params={sp} pathname={pathname} />
        <SearchGate site={site} conn={conn} />
      </>
    );
  }
  const property = conn.active;
  const db = getDb();
  const metric = SEARCH_METRICS.includes(sp.metric as SearchMetric) ? (sp.metric as SearchMetric) : "clicks";
  const [summary, devices, countries, queries, pages] = await Promise.all([
    searchSummary(property.id, range, view.compare),
    gscSegments(db, property.id, range.from, range.to, "device", 3),
    gscSegments(db, property.id, range.from, range.to, "country", 8),
    searchTable("query", property.id, range, false, { limit: 8 }),
    searchTable("page", property.id, range, false, { limit: 8 }),
  ]);
  const coverage = await queryCoverage(property.id, range, summary.totals);
  const { totals, previous } = summary;
  const now = metricsOf(totals);
  const before = previous ? metricsOf(previous) : null;
  const through = throughLabel(property.finalizedThrough);
  const compared = view.compare ? comparedLabel(range) : undefined;
  const query = viewQuery(sp);
  const keep = sp.property ? `${query ? `${query}&` : "?"}property=${property.id}` : query;

  const series: TrendSeries[] = [{ key: "value", label: METRICS[metric].series, ...INK, emphasis: true }];
  if (summary.previousSeries) series.push({ key: "previous", label: `Previous ${range.days} days`, ...QUIET, emphasis: false });
  const rows: TrendRow[] = summary.series.map((point, index) => ({
    label: formatDay(point.date),
    longLabel: formatDayLong(point.date),
    value: valueOf(point, metric),
    previous: summary.previousSeries?.[index] ? valueOf(summary.previousSeries[index], metric) : undefined,
  }));
  const hasData = totals.days > 0;

  return (
    <>
      <SeoHeader title="Search performance" site={site} conn={conn} range={range} compare={view.compare} params={sp} pathname={pathname} />
      <ConnectionNotice site={site} conn={conn} />
      <div className="sk-enter flex flex-col gap-4">
        <KpiRow>
          <Kpi
            label="Clicks"
            value={hasData ? totals.clicks : null}
            unavailable={{ text: "No data", reason: "Google reported nothing for these days" }}
            change={view.compare ? computeChange(totals.clicks, previous?.clicks) : undefined}
            delta={previous ? totals.clicks - previous.clicks : null}
            comparedTo={compared}
            source="gsc"
            sourceDetail={through}
          />
          <Kpi
            label="Impressions"
            value={hasData ? totals.impressions : null}
            unavailable={{ text: "No data", reason: "Google reported nothing for these days" }}
            change={view.compare ? computeChange(totals.impressions, previous?.impressions) : undefined}
            delta={previous ? totals.impressions - previous.impressions : null}
            comparedTo={compared}
            source="gsc"
            sourceDetail={through}
          />
          <Kpi
            label="CTR"
            value={now.ctr === null ? null : formatPercent(now.ctr, 2)}
            unavailable={{ text: "No impressions", reason: "Nothing to divide by in this range" }}
            change={view.compare ? pointChange(now.ctr, before?.ctr) : undefined}
            comparedTo={compared}
            source="gsc"
            sourceDetail={through}
          />
          <Kpi
            label="Average position"
            value={now.position === null ? null : formatPosition(now.position)}
            unavailable={{ text: "No impressions", reason: "Position needs at least one impression" }}
            change={view.compare ? positionChange(now.position, before?.position) : undefined}
            comparedTo={compared}
            upIsGood={false}
            source="gsc"
            sourceDetail={through}
          />
        </KpiRow>

        <Panel>
          <PanelHeader
            title={`${METRICS[metric].label} by day`}
            description={METRICS[metric].note}
            meta={<Provenance source="gsc" detail={through} />}
            action={
              <LinkTabs
                label="Metric"
                items={SEARCH_METRICS.map((m) => ({ href: withParams(pathname, sp, { metric: m === "clicks" ? null : m }), label: METRICS[m].label, active: m === metric }))}
              />
            }
          />
          {hasData ? (
            <div className="pb-4">
              <TrendChart rows={rows} series={series} height={320} ariaLabel={`${METRICS[metric].label} per day for ${site.name}, ${formatDayRange(range.from, range.to)}, from Search Console`} />
            </div>
          ) : (
            <PanelEmpty title="No search data in this range">Google reported no impressions for these days. That is different from data that has not been synced</PanelEmpty>
          )}
          {range.clamped ? (
            <p className="border-t border-line px-5 py-3 text-[12px] leading-4 text-ink-3">
              The range ends on {formatDayLong(range.to)}, the newest day Google has finalized. Later days are left out until they are final
            </p>
          ) : null}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          {(
            [
              { kind: "query", title: "Top queries", href: `${base}/seo/queries${keep}`, all: "All queries", table: queries },
              { kind: "page", title: "Top pages", href: `${base}/seo/pages${keep}`, all: "All pages", table: pages },
            ] as const
          ).map((block) => (
            <Panel key={block.kind}>
              <PanelHeader
                title={block.title}
                action={
                  <Link href={block.href} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                    {block.all}
                  </Link>
                }
              />
              {block.table.rows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-y border-line text-[12px] text-ink-3">
                        <th scope="col" className="h-10 pl-5 text-left font-normal">{block.kind === "query" ? "Query" : "Page"}</th>
                        <th scope="col" className="h-10 px-3 text-right font-normal">Clicks</th>
                        <th scope="col" className="h-10 px-3 text-right font-normal">Impressions</th>
                        <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal whitespace-nowrap">Avg. position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {block.table.rows.map((row) => (
                        <tr key={row.key} className="border-b border-line last:border-0">
                          <th scope="row" className="h-10 w-full max-w-0 pl-5 text-left font-normal">
                            <span className={block.kind === "page" ? "block truncate font-mono text-[12px] text-ink" : "block truncate text-ink"} title={row.key}>
                              {block.kind === "page" ? row.key.replace(/^https?:\/\/[^/]+/, "") || "/" : row.key}
                            </span>
                          </th>
                          <td className="tnum h-10 px-3 text-right text-ink">{formatNumber(row.clicks)}</td>
                          <td className="tnum h-10 px-3 text-right text-ink-2">{formatNumber(row.impressions)}</td>
                          <td className="tnum h-10 pr-5 pl-3 text-right text-ink-2">{formatPosition(metricsOf(row).position)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <PanelEmpty title={`No ${block.kind === "query" ? "queries" : "pages"} stored for this range`}>Detail fills in as the backfill reaches these days</PanelEmpty>
              )}
              {block.kind === "query" && coverage.clickShare !== null && coverage.queries > 0 ? (
                <p className="border-t border-line px-5 py-3 text-[12px] leading-4 text-ink-3">
                  Queries shown by name account for {formatPercent(coverage.clickShare, 0)} of clicks in this range. Google withholds the rest as anonymized queries; they are not estimated
                </p>
              ) : null}
            </Panel>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Devices" description="Clicks by device class" />
            {devices.length ? (
              <PanelBody>
                <BarList valueLabel="clicks" items={devices.map((row) => ({ key: row.value, label: deviceLabel(row.value), value: row.clicks }))} />
              </PanelBody>
            ) : (
              <PanelEmpty title="No device split for this range" />
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Countries" description="Clicks by searcher country" />
            {countries.length ? (
              <PanelBody>
                <BarList
                  valueLabel="clicks"
                  items={countries.map((row) => {
                    const code = alpha2Of(row.value);
                    return { key: row.value, label: code ? countryName(code) : "Unknown region", value: row.clicks };
                  })}
                />
              </PanelBody>
            ) : (
              <PanelEmpty title="No country split stored for this range">Country detail fills in as the backfill reaches these days</PanelEmpty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default function SearchPerformancePage({ params, searchParams }: PageProps<"/sites/[siteId]/seo/search">) {
  return (
    <Suspense fallback={<ReportFallback title="Search performance" />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

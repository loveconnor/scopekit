import { addFilterHref, FilterChips } from "@/components/scopekit/filter-chips";
import { MetricLabel } from "@/components/scopekit/kpi";
import { Panel, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { RawEventsNote, ReportFallback, SiteReportHeader } from "@/components/scopekit/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDayRange, formatNumber } from "@/lib/format";
import { viewQuery, withParams, type SearchParams } from "@/lib/params";
import { loadSiteView } from "@/lib/site-view";
import { pagesReport } from "@/lib/tables";
import type { PageSort } from "@scopekit/db";
import { ArrowDown, Download } from "honestui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Pages" };

const COLUMNS: { key: PageSort; label: React.ReactNode; rollupOnly?: boolean }[] = [
  { key: "pageviews", label: <MetricLabel metric="pageviews" /> },
  { key: "sessions", label: "Sessions" },
  { key: "visitors", label: <MetricLabel metric="visitors" /> },
  { key: "entries", label: <MetricLabel metric="entries" />, rollupOnly: true },
  { key: "exits", label: <MetricLabel metric="exits" />, rollupOnly: true },
  { key: "goalCompletions", label: "Goal completions", rollupOnly: true },
];

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, params: sp, view, base } = await loadSiteView(params, searchParams);
  const pathname = `${base}/analytics/pages`;
  const q = typeof sp.q === "string" ? sp.q : "";
  const report = await pagesReport(site, view, {
    search: q,
    sort: typeof sp.sort === "string" ? sp.sort : undefined,
    cursor: typeof sp.cursor === "string" ? sp.cursor : undefined,
  });
  const { range } = report;
  const rangeLabel = range.preset === "24h" ? "Last 24 hours" : formatDayRange(range.from, range.to);
  const columns = COLUMNS.filter((column) => !(report.fromRawEvents && column.rollupOnly));
  const exportQuery = new URLSearchParams(viewQuery(sp).slice(1));
  exportQuery.set("format", "csv");
  if (q) exportQuery.set("q", q);

  return (
    <>
      <SiteReportHeader
        title="Pages"
        site={site}
        range={range}
        rangeLabel={rangeLabel}
        compare={view.compare}
        actions={
          <Button variant="outline" size="sm" render={<a href={`/api/sites/${site.id}/analytics/pages?${exportQuery}`} download />}>
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            Export CSV
          </Button>
        }
      />
      <FilterChips pathname={pathname} params={sp} view={view} />
      <Panel className="sk-enter">
        <PanelHeader
          title={report.total === null ? "Pages" : `${formatNumber(report.total)} ${report.total === 1 ? "page" : "pages"}`}
          description="Paths are normalized: tracking parameters and trailing slashes are removed"
          meta={<Provenance source="scopekit" detail={report.fromRawEvents ? "raw events" : "daily rollups"} />}
        />
        {!report.fromRawEvents ? (
          <form action={pathname} className="flex items-center gap-2 px-5 pb-3">
            {Object.entries(sp).flatMap(([key, value]) =>
              key === "q" || key === "cursor"
                ? []
                : (Array.isArray(value) ? value : [value]).map((item) => (item ? <input key={`${key}:${item}`} type="hidden" name={key} value={item} /> : null)),
            )}
            <Input size="sm" type="search" name="q" defaultValue={q} aria-label="Search paths" placeholder="Search paths" className="max-w-[280px] font-mono" />
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          </form>
        ) : null}
        {report.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-line text-[12px] text-ink-3">
                  <th scope="col" className="h-10 pl-5 text-left font-normal">
                    Page
                  </th>
                  {columns.map((column) => {
                    const active = report.sort === column.key;
                    return (
                      <th key={column.key} scope="col" aria-sort={active ? "descending" : undefined} className="h-10 px-3 text-right font-normal whitespace-nowrap last:pr-5">
                        {report.fromRawEvents ? (
                          column.label
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {column.label}
                            <Link
                              href={withParams(pathname, sp, { sort: column.key, cursor: null })}
                              aria-label={`Sort by ${column.key}`}
                              className={active ? "text-ink" : "text-ink-3/40 hover:text-ink-2"}
                              scroll={false}
                            >
                              <ArrowDown size={12} strokeWidth={1.5} aria-hidden="true" />
                            </Link>
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.path} className="border-b border-line transition-colors duration-150 ease-out last:border-0 hover:bg-raised">
                    <th scope="row" className="h-11 w-full max-w-0 pl-5 text-left font-normal">
                      <Link
                        href={addFilterHref(`${base}/analytics`, Object.fromEntries(new URLSearchParams(viewQuery(sp).slice(1))), "page", row.path)}
                        className="block truncate rounded-sm font-mono text-[12px] text-ink"
                        title={`${row.path} · open traffic for this page`}
                      >
                        {row.path}
                      </Link>
                    </th>
                    {columns.map((column) => (
                      <td key={column.key} className="tnum h-11 px-3 text-right text-ink last:pr-5">
                        {formatNumber(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelEmpty title={q ? `No path contains “${q}”` : "No pageviews in this range"}>
            {q ? "Check the spelling or clear the search" : "Pages appear once the site reports traffic in the selected period"}
          </PanelEmpty>
        )}
        {report.nextCursor || sp.cursor ? (
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            {sp.cursor ? (
              <Button variant="outline" size="sm" render={<Link href={withParams(pathname, sp, { cursor: null })} scroll={false} />}>
                First page
              </Button>
            ) : (
              <span />
            )}
            {report.nextCursor ? (
              <Button variant="outline" size="sm" render={<Link href={withParams(pathname, sp, { cursor: report.nextCursor })} scroll={false} />}>
                Next 50
              </Button>
            ) : null}
          </div>
        ) : null}
        {report.fromRawEvents ? (
          <div className="border-t border-line px-5 py-3">
            <RawEventsNote retentionDays={site.settings.retentionDays} truncated={false} filtered={view.hasFilters} />
          </div>
        ) : null}
      </Panel>
    </>
  );
}

export default function PagesPage({ params, searchParams }: PageProps<"/sites/[siteId]/analytics/pages">) {
  return (
    <Suspense fallback={<ReportFallback title="Pages" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

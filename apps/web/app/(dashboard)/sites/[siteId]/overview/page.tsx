import { BarList } from "@/components/scopekit/bar-list";
import { CodeBlock, VerifyTracking } from "@/components/scopekit/install";
import { buildSnippet } from "@/lib/snippet";
import { AnnotationsPanel, SeverityLabel } from "@/components/scopekit/health";
import { Kpi, KpiRow, MetricLabel } from "@/components/scopekit/kpi";
import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { RangeControl } from "@/components/scopekit/range-control";
import { ReportFallback } from "@/components/scopekit/site-header";
import { change, reportLabels, trendRows } from "@/components/scopekit/site-report";
import { siteStatus, StatusBadge } from "@/components/scopekit/status";
import { TrendChart } from "@/components/scopekit/trend-chart";
import { env } from "@/lib/env";
import { settingsHref, throughLabel } from "@/components/scopekit/seo";
import { computeChange, formatDateTime, formatNumber, formatPosition, formatRelative } from "@/lib/format";
import { isReady, loadSearchConnection, metricsOf, searchRange, searchSummary, searchTable } from "@/lib/seo";
import { viewQuery, type SearchParams } from "@/lib/params";
import { requestTime, siteReport } from "@/lib/reports";
import { loadSiteView, SERIES } from "@/lib/site-view";
import { pagesReport, sourcesReport } from "@/lib/tables";
import { sourceLabel } from "@scopekit/analytics";
import { HEALTH_LABELS, loadAuditState, pathOfUrl, ruleTitle } from "@/lib/health";
import { rateCwv } from "@scopekit/contracts";
import { cruxSeries, getDb, latestPerformance, listAlerts, listAnnotations, listAuditLogs, topOpenIssues } from "@scopekit/db";
import { ExternalLink } from "honestui/icons";
import Link from "next/link";
import { Suspense } from "react";

const PRIVACY_LABELS = { default: "Privacy-first", strict: "Strict", consent: "Consent-based" } as const;

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, params: sp, view, base } = await loadSiteView(params, searchParams);
  const now = requestTime();
  const status = siteStatus({ ...site, trackingEnabled: site.settings.trackingEnabled }, now);
  const query = viewQuery(sp);

  const hero = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <a
        href={site.canonicalOrigin}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-sm font-mono text-[12px] text-ink-2 hover:text-ink"
      >
        {site.primaryHostname}
        <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
        <span className="sr-only">Opens in a new tab</span>
      </a>
      <StatusBadge status={status} />
      <span className="text-[13px] text-ink-2">Last event {formatRelative(site.lastEventAt, now).toLowerCase()}</span>
      <span className="text-[13px] text-ink-2">{PRIVACY_LABELS[site.privacyMode]} tracking</span>
      {site.isDemo ? <span className="font-mono text-[11px] text-warning">demo data</span> : null}
    </div>
  );

  // A site that has never sent an event gets setup help, not a wall of zeros.
  if (!site.firstEventAt) {
    return (
      <>
        <PageHeader title={site.name} subtitle={hero} />
        <Panel className="sk-enter max-w-[760px]">
          <PanelHeader title="Waiting for the first event" description="Add the snippet to every page of the site, then verify it here" />
          <PanelBody className="flex flex-col gap-5">
            {site.publicTrackingId && env.collectorUrl ? (
              <CodeBlock
                label="HTML"
                code={buildSnippet({
                  collectorUrl: env.collectorUrl,
                  publicId: site.publicTrackingId,
                  consent: site.privacyMode === "consent",
                  queryParams: site.settings.allowedQueryParams,
                })}
              />
            ) : null}
            <VerifyTracking siteId={site.id} />
          </PanelBody>
        </Panel>
      </>
    );
  }

  const [report, pages, sources, activity] = await Promise.all([
    siteReport(site, view),
    pagesReport(site, view, { limit: 8 }),
    sourcesReport(site, view, "source"),
    listAuditLogs(getDb(), { siteId: site.id, limit: 5 }),
  ]);
  const { totals, previous, range } = report;
  const { rangeLabel, comparedTo, through } = reportLabels(report, site.timezone);
  const db = getDb();
  const [audit, topIssues, lab, fieldSeries, annotations, openAlerts] = await Promise.all([
    loadAuditState(site.id),
    topOpenIssues(db, site.id, 5),
    latestPerformance(db, site.id, `${site.canonicalOrigin}/`),
    cruxSeries(db, site.id, "PHONE", 1),
    listAnnotations(db, site.id, undefined, 5),
    listAlerts(db, { siteIds: [site.id], statuses: ["open"], limit: 3 }),
  ]);
  const field = fieldSeries[0] ?? null;

  // Search data has its own finalized range. It sits beside the analytics figures and is never mixed into them.
  const conn = await loadSearchConnection(site.id);
  const hourly = range.granularity === "hour";
  const search =
    isReady(conn) && !hourly
      ? await (async () => {
          const searchRangeNow = await searchRange(view, conn.active.finalizedThrough);
          const [summary, queries] = await Promise.all([
            searchSummary(conn.active.id, searchRangeNow, view.compare),
            searchTable("query", conn.active.id, searchRangeNow, false, { limit: 6 }),
          ]);
          return { range: searchRangeNow, summary, queries, through: throughLabel(conn.active.finalizedThrough) };
        })()
      : null;
  const searchUnavailable = hourly
    ? { text: "Not available", reason: "Search data is daily and lags by days. Pick a daily range" }
    : conn.state === "waiting"
      ? { text: "Syncing", reason: "The first Search Console sync has not finished" }
      : { text: "Not connected", reason: "No Search Console property is linked" };
  const searchCompared = view.compare && search ? `vs previous ${search.range.days} days` : undefined;
  const compared = view.compare ? comparedTo : undefined;
  const visitorDetail = report.meta.visitorMode === "first-party-id" ? "first-party ID" : "estimated per day";

  return (
    <>
      <PageHeader
        title={site.name}
        subtitle={hero}
        actions={<RangeControl preset={range.preset} from={range.from} to={range.to} compare={view.compare} />}
      />
      <div className="sk-enter flex flex-col gap-4">
        <KpiRow columns={6}>
          <Kpi
            label={<MetricLabel metric="visitors" />}
            value={totals.visitors}
            unavailable={{ text: "Not available", reason: "Strict mode does not estimate visitors" }}
            change={view.compare ? change(totals.visitors, previous?.visitors) : undefined}
            comparedTo={compared}
            source="scopekit"
            sourceDetail={visitorDetail}
          />
          <Kpi
            label={<MetricLabel metric="pageviews" />}
            value={totals.pageviews}
            change={view.compare ? change(totals.pageviews, previous?.pageviews) : undefined}
            comparedTo={compared}
            source="scopekit"
            sourceDetail={through}
          />
          <Kpi
            label={<MetricLabel metric="sessions" />}
            value={totals.sessions}
            change={view.compare ? change(totals.sessions, previous?.sessions) : undefined}
            comparedTo={compared}
            source="scopekit"
            sourceDetail={through}
          />
          <Kpi
            label={<MetricLabel metric="conversions" />}
            value={report.sessionMetricsAvailable ? totals.conversions : null}
            unavailable={{ text: "Not available", reason: "Needs whole sessions; remove filters or use a daily range" }}
            change={view.compare && report.sessionMetricsAvailable ? change(totals.conversions, previous?.conversions) : undefined}
            comparedTo={compared}
            source="scopekit"
            sourceDetail={through}
          />
          <Kpi
            label="Search clicks"
            value={search && search.summary.totals.days > 0 ? search.summary.totals.clicks : null}
            unavailable={search ? { text: "No data", reason: "Google reported nothing for these days" } : searchUnavailable}
            change={view.compare && search ? computeChange(search.summary.totals.clicks, search.summary.previous?.clicks) : undefined}
            comparedTo={searchCompared}
            source="gsc"
            sourceDetail={search ? search.through : conn.state === "waiting" ? "syncing" : "not linked"}
          />
          <Kpi
            label="Search impressions"
            value={search && search.summary.totals.days > 0 ? search.summary.totals.impressions : null}
            unavailable={search ? { text: "No data", reason: "Google reported nothing for these days" } : searchUnavailable}
            change={view.compare && search ? computeChange(search.summary.totals.impressions, search.summary.previous?.impressions) : undefined}
            comparedTo={searchCompared}
            source="gsc"
            sourceDetail={search ? search.through : conn.state === "waiting" ? "syncing" : "not linked"}
          />
        </KpiRow>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="Traffic"
              meta={<Provenance source="scopekit" detail={through} />}
              action={
                <Link href={`${base}/analytics${query}`} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                  Open traffic
                </Link>
              }
            />
            <div className="pb-4">
              <TrendChart
                rows={trendRows(report, site.timezone)}
                series={totals.visitors === null ? [SERIES.pageviews] : [SERIES.pageviews, SERIES.visitors]}
                ariaLabel={`Pageviews and estimated visitors for ${site.name}, ${rangeLabel}`}
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Top sources" description="Sessions by where they started" />
            {sources.rows.length ? (
              <PanelBody>
                <BarList
                  valueLabel="sessions"
                  items={sources.rows.slice(0, 7).map((row) => ({
                    key: `${row.key}/${row.medium}`,
                    label: sourceLabel(row.key, row.medium ?? ""),
                    value: row.sessions,
                  }))}
                />
                <Link href={`${base}/analytics/sources${query}`} className="mt-3 inline-block rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                  All sources
                </Link>
              </PanelBody>
            ) : (
              <PanelEmpty title="No sessions in this range" />
            )}
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="Top pages"
              action={
                <Link href={`${base}/analytics/pages${query}`} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                  All pages
                </Link>
              }
            />
            {pages.rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-y border-line text-[12px] text-ink-3">
                      <th scope="col" className="h-10 pl-5 text-left font-normal">Page</th>
                      <th scope="col" className="h-10 px-3 text-right font-normal">Pageviews</th>
                      <th scope="col" className="h-10 px-3 text-right font-normal">Visitors</th>
                      <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal whitespace-nowrap">Goal completions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.rows.map((row) => (
                      <tr key={row.path} className="border-b border-line last:border-0">
                        <th scope="row" className="h-10 max-w-0 w-full pl-5 text-left font-normal">
                          <span className="block truncate font-mono text-[12px] text-ink" title={row.path}>{row.path}</span>
                        </th>
                        <td className="tnum h-10 px-3 text-right text-ink">{formatNumber(row.pageviews)}</td>
                        <td className="tnum h-10 px-3 text-right text-ink-2">{formatNumber(row.visitors)}</td>
                        <td className="tnum h-10 pr-5 pl-3 text-right text-ink-2">{formatNumber(row.goalCompletions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <PanelEmpty title="No pageviews in this range" />
            )}
          </Panel>

          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader
                title="Search"
                description={search ? "Top queries by clicks" : undefined}
                meta={search ? <Provenance source="gsc" detail={search.through} /> : undefined}
              />
              {search ? (
                search.queries.rows.length ? (
                  <>
                    <ul className="px-5">
                      {search.queries.rows.map((row) => (
                        <li key={row.key} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
                          <span className="min-w-0 truncate text-[13px] leading-5 text-ink" title={row.key}>{row.key}</span>
                          <span className="tnum shrink-0 text-[12px] leading-5 text-ink-2">
                            {formatNumber(row.clicks)} clicks · pos. {formatPosition(metricsOf(row).position)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="px-5 pt-2 pb-4">
                      <Link href={`${base}/seo/search`} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                        Search performance
                      </Link>
                    </div>
                  </>
                ) : (
                  <PanelEmpty title="No queries in this range">Google reported no named queries for these days</PanelEmpty>
                )
              ) : (
                <PanelEmpty
                  title={conn.state === "waiting" ? "First sync in progress" : hourly ? "Not available for this range" : "Search Console is not connected"}
                  action={
                    conn.state === "not_connected" && !site.isDemo ? (
                      <Link href={settingsHref(site.id)} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                        Connect Search Console
                      </Link>
                    ) : undefined
                  }
                >
                  {hourly ? "Search data is daily and lags by days. Pick a daily range to see it" : conn.state === "waiting" ? "Search figures appear when it finishes" : "Search figures stay empty, not zero, until a property is linked"}
                </PanelEmpty>
              )}
            </Panel>
            <Panel>
              <PanelHeader
                title="Site audit"
                description={audit.latestWithPages ? HEALTH_LABELS[audit.health] : undefined}
                action={
                  <Link href={`${base}/audit`} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                    Open audit
                  </Link>
                }
              />
              {!audit.latestWithPages ? (
                <PanelEmpty title="No audit yet">Run a crawl to check for broken pages, titles, canonicals and sitemap problems</PanelEmpty>
              ) : topIssues.length ? (
                <ul className="px-5 pb-3">
                  {topIssues.map((issue) => (
                    <li key={issue.id} className="border-b border-line py-2 last:border-0">
                      <Link href={`${base}/audit?rule=${issue.ruleId}`} className="block rounded-sm">
                        <span className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate text-[13px] leading-5 text-ink">{ruleTitle(issue.ruleId)}</span>
                          <SeverityLabel severity={issue.severity} className="text-[12px] text-ink-2" />
                        </span>
                        <span className="block truncate font-mono text-[11px] leading-4 text-ink-3">{pathOfUrl(issue.url)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <PanelEmpty title="No critical or high issues open">{audit.latestWithPages.coverageComplete ? "From the last complete crawl" : "The last crawl was partial, so this covers only the pages it visited"}</PanelEmpty>
              )}
            </Panel>
            <Panel>
              <PanelHeader
                title="Web vitals"
                description="Homepage, phones"
                action={
                  <Link href={`${base}/performance`} className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
                    Open performance
                  </Link>
                }
              />
              <dl className="px-5 pb-4 text-[13px] leading-5">
                <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                  <dt className="text-ink-2">
                    Lab performance score
                    <span className="block font-mono text-[11px] leading-4 text-ink-3">Lighthouse · one test load</span>
                  </dt>
                  <dd className="tnum text-ink">{lab.mobile?.scores?.performance ?? <span className="text-ink-2">No run yet</span>}</dd>
                </div>
                {(
                  [
                    ["Field LCP", field?.lcpP75 ?? null, "lcp", (v: number) => `${(v / 1000).toFixed(1)} s`],
                    ["Field INP", field?.inpP75 ?? null, "inp", (v: number) => `${Math.round(v)} ms`],
                    ["Field CLS", field?.clsP75 ?? null, "cls", (v: number) => v.toFixed(2)],
                  ] as const
                ).map(([name, value, metric, format]) => (
                  <div key={name} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
                    <dt className="text-ink-2">
                      {name}
                      <span className="block font-mono text-[11px] leading-4 text-ink-3">CrUX · real visitors, p75</span>
                    </dt>
                    <dd className="tnum text-right text-ink">
                      {value === null ? <span className="text-ink-2">Not available</span> : <>{format(value)}<span className="block text-[12px] leading-4 text-ink-3">{rateCwv(metric, value).replace("_", " ")}</span></>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
            {openAlerts.length ? (
              <Panel>
                <PanelHeader title="Open alerts" action={<Link href="/alerts" className="rounded-sm text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">All alerts</Link>} />
                <ul className="px-5 pb-3">
                  {openAlerts.map((alert) => (
                    <li key={alert.id} className="border-b border-line py-2 text-[13px] leading-5 text-ink last:border-0">{alert.headline}</li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            <AnnotationsPanel site={site} annotations={annotations} />
            <Panel>
              <PanelHeader title="Recent changes" />
              {activity.length ? (
                <ul className="px-5 pb-4">
                  {activity.map((entry) => (
                    <li key={entry.id} className="border-b border-line py-2 last:border-0">
                      <span className="block text-[13px] leading-5 text-ink">{entry.summary.replace(`${site.name}: `, "")}</span>
                      <span className="block font-mono text-[11px] leading-4 text-ink-3">{formatDateTime(entry.at, site.timezone)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <PanelEmpty title="No changes recorded">Setting and goal changes for this site appear here</PanelEmpty>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

export default function SiteOverviewPage({ params, searchParams }: PageProps<"/sites/[siteId]/overview">) {
  return (
    <Suspense fallback={<ReportFallback title="Website" />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { ConnectionNotice, SearchGate, SeoHeader } from "@/components/scopekit/seo";
import { InspectButton, InspectForm } from "@/components/scopekit/seo-client";
import { ReportFallback } from "@/components/scopekit/site-header";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import { requestTime } from "@/lib/reports";
import { INSPECTION_DAILY_CAP, isReady, loadSeoView, pacificToday } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { startOfLocalDay } from "@scopekit/analytics";
import { GSC_TIMEZONE } from "@scopekit/contracts";
import { countInspectionsSince, getDb, latestInspections } from "@scopekit/db";
import { ExternalLink } from "honestui/icons";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Indexing" };

// Google's verdict values, in plain words.
const VERDICTS: Record<string, { label: string; tone: string }> = {
  PASS: { label: "On Google", tone: "bg-positive" },
  PARTIAL: { label: "On Google, with warnings", tone: "bg-warning" },
  FAIL: { label: "Not on Google: error", tone: "bg-negative" },
  NEUTRAL: { label: "Not on Google: excluded", tone: "bg-ink-3/50" },
};
const verdictOf = (value: string | null) => VERDICTS[value ?? ""] ?? { label: "Unknown", tone: "bg-ink-3/50" };
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, sp, view, conn, base } = await loadSeoView(params, searchParams);
  const pathname = `${base}/seo/indexing`;
  if (!isReady(conn)) {
    return (
      <>
        <SeoHeader title="Indexing" site={site} conn={conn} range={null} compare={view.compare} params={sp} pathname={pathname} />
        <SearchGate site={site} conn={conn} />
      </>
    );
  }
  const property = conn.active;
  const db = getDb();
  const now = requestTime();
  const [inspections, usedToday] = await Promise.all([
    latestInspections(db, property.id),
    countInspectionsSince(db, property.id, startOfLocalDay(pacificToday(new Date(now)), GSC_TIMEZONE)),
  ]);
  const disabledReason = property.isDemo
    ? "Demo properties are synthetic, so there is nothing for Google to check"
    : property.connectionStatus !== "connected"
      ? "Reconnect the Google account to check URLs"
      : usedToday >= INSPECTION_DAILY_CAP
        ? "Today's checks are used up. The limit resets at midnight Pacific Time"
        : undefined;

  return (
    <>
      <SeoHeader title="Indexing" site={site} conn={conn} range={null} compare={false} params={sp} pathname={pathname} showRange={false} />
      <ConnectionNotice site={site} conn={conn} />
      <div className="sk-enter flex flex-col gap-4">
        <Panel>
          <PanelHeader
            title="Check a URL"
            description="For the pages you care about. There is no request-indexing button: Google only offers that API for job postings and livestreams"
            meta={<span className="tnum font-mono text-[11px] leading-4 text-ink-3">{formatNumber(usedToday)} of {formatNumber(INSPECTION_DAILY_CAP)} checks today</span>}
          />
          <PanelBody>
            <InspectForm siteId={site.id} origin={site.canonicalOrigin} disabledReason={disabledReason} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title={`${formatNumber(inspections.length)} checked ${inspections.length === 1 ? "URL" : "URLs"}`}
            description="Google's indexed version at the time of each check, not a live test of the page"
            meta={<Provenance source="gsc" detail="URL Inspection" />}
          />
          {inspections.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-y border-line text-[12px] text-ink-3">
                    <th scope="col" className="h-10 pl-5 text-left font-normal">URL</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal">Index status</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal">Canonical</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal whitespace-nowrap">Last crawl</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal">Checked</th>
                    <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {inspections.map((row) => {
                    const verdict = verdictOf(row.indexVerdict);
                    const canonicalDiffers = row.googleCanonical && row.userCanonical && row.googleCanonical !== row.userCanonical;
                    return (
                      <tr key={row.id} className="border-b border-line align-top last:border-0">
                        <th scope="row" className="max-w-[280px] py-3 pl-5 text-left font-normal">
                          <span className="block truncate font-mono text-[12px] leading-5 text-ink" title={row.url}>{pathOf(row.url)}</span>
                        </th>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-2 leading-5 text-ink">
                            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", verdict.tone)} />
                            {verdict.label}
                          </span>
                          <span className="block text-[12px] leading-4 text-ink-3">{row.coverageState ?? "No coverage state returned"}</span>
                          {row.previousVerdict && row.previousVerdict !== row.indexVerdict ? (
                            <span className="block text-[12px] leading-4 text-warning">Was {verdictOf(row.previousVerdict).label.toLowerCase()} at the check before</span>
                          ) : null}
                        </td>
                        <td className="max-w-[240px] px-3 py-3">
                          {row.googleCanonical ? (
                            <>
                              <span className="block truncate font-mono text-[12px] leading-5 text-ink-2" title={row.googleCanonical}>{pathOf(row.googleCanonical)}</span>
                              <span className={cn("block text-[12px] leading-4", canonicalDiffers ? "text-warning" : "text-ink-3")}>
                                {canonicalDiffers ? `Google chose this over ${pathOf(row.userCanonical!)}` : "Google-selected, same as declared"}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-3">Not reported</span>
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                          {row.lastCrawlAt ? formatDateTime(row.lastCrawlAt, site.timezone) : "Never"}
                          {row.crawledAs && /^(MOBILE|DESKTOP)$/.test(row.crawledAs) ? <span className="block text-[12px] leading-4 text-ink-3">as {row.crawledAs.toLowerCase()}</span> : null}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                          {formatRelative(row.checkedAt, now)}
                          {row.checks > 1 ? <span className="block text-[12px] leading-4 text-ink-3">{formatNumber(row.checks)} checks</span> : null}
                        </td>
                        <td className="py-3 pr-5 pl-3">
                          <span className="flex items-start justify-end gap-2">
                            {row.inspectionLink ? (
                              <a href={row.inspectionLink} target="_blank" rel="noreferrer" className="inline-flex h-6 items-center gap-1 rounded-sm text-[12px] text-ink-2 hover:text-ink">
                                Open
                                <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
                                <span className="sr-only">in Search Console, new tab</span>
                              </a>
                            ) : null}
                            {disabledReason ? null : <InspectButton siteId={site.id} url={row.url} />}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <PanelEmpty title="No URL has been checked">Check a URL above, or use Check index status on a page in Search pages</PanelEmpty>
          )}
        </Panel>
      </div>
    </>
  );
}

export default function IndexingPage({ params, searchParams }: PageProps<"/sites/[siteId]/seo/indexing">) {
  return (
    <Suspense fallback={<ReportFallback title="Indexing" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

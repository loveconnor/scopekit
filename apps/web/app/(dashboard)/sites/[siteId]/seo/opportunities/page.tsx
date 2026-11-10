import { Panel, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { ConnectionNotice, LinkTabs, SearchGate, SeoHeader, throughLabel } from "@/components/scopekit/seo";
import { OpportunityActions } from "@/components/scopekit/seo-client";
import { ReportFallback } from "@/components/scopekit/site-header";
import { formatDayRange, formatNumber, formatPercent, formatPosition } from "@/lib/format";
import { withParams, type SearchParams } from "@/lib/params";
import { isReady, loadSeoView } from "@/lib/seo";
import { OPPORTUNITY_CATEGORIES, OPPORTUNITY_STATUSES, type OpportunityCategory, type OpportunityStatus } from "@scopekit/contracts";
import { countOpportunities, getDb, listOpportunities, type Opportunity } from "@scopekit/db";
import { OPPORTUNITY_THRESHOLDS, SCORE_WEIGHTS } from "@scopekit/seo";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Opportunities" };

const STATUS_LABELS: Record<OpportunityStatus, string> = { new: "New", in_progress: "In progress", dismissed: "Dismissed", resolved: "Resolved" };
const CATEGORY_LABELS: Record<OpportunityCategory, string> = { ctr: "CTR", content: "Content", technical: "Technical", performance: "Performance" };
const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

/** What was found, the figures behind it, and what to look at. No promised outcome. */
function describe(o: Opportunity): { title: string; evidence: string; suggestion: string } {
  const e = o.evidence;
  if (o.rule === "low_ctr") {
    return {
      title: "CTR is below comparable queries",
      evidence: `${formatPercent(e.ctr, 1)} CTR at position ${formatPosition(e.position)} over ${formatNumber(e.impressions)} impressions. Your other queries at position ${e.cohortPosition} average ${formatPercent(e.cohortCtr ?? null, 1)}`,
      suggestion: "Check that the page title and snippet answer what this query is looking for",
    };
  }
  if (o.rule === "near_page_one") {
    return {
      title: "Ranking just below the top results",
      evidence: `Average position ${formatPosition(e.position)} over ${formatNumber(e.impressions)} impressions, seen in ${e.weeksWithImpressions} of 4 weeks. ${formatPercent(e.pageShare ?? null, 0)} of impressions go to ${e.page ? pathOf(e.page) : "one page"}`,
      suggestion: "One page is the clear match. Improving that page is the most direct way to move up",
    };
  }
  const drop = (e.previousClicks ?? 0) - e.clicks;
  return {
    title: "Clicks are down against the previous 28 days",
    evidence: `${formatNumber(e.previousClicks ?? 0)} clicks, then ${formatNumber(e.clicks)}: ${formatNumber(drop)} fewer (${formatPercent(e.previousClicks ? drop / e.previousClicks : null, 0)})`,
    suggestion: "Check whether position, the snippet or demand changed for this page",
  };
}

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, sp, view, conn, base } = await loadSeoView(params, searchParams);
  const pathname = `${base}/seo/opportunities`;
  if (!isReady(conn)) {
    return (
      <>
        <SeoHeader title="Opportunities" site={site} conn={conn} range={null} compare={view.compare} params={sp} pathname={pathname} />
        <SearchGate site={site} conn={conn} />
      </>
    );
  }
  const property = conn.active;
  const db = getDb();
  const status = OPPORTUNITY_STATUSES.includes(sp.status as OpportunityStatus) ? (sp.status as OpportunityStatus) : "new";
  const category = OPPORTUNITY_CATEGORIES.includes(sp.category as OpportunityCategory) ? (sp.category as OpportunityCategory) : null;
  const [items, counts] = await Promise.all([listOpportunities(db, property.id, { statuses: [status], category: category ?? undefined }), countOpportunities(db, property.id)]);
  const window = items[0]?.evidence.window;
  const unbuilt = category === "technical" || category === "performance";
  const t = OPPORTUNITY_THRESHOLDS;

  return (
    <>
      <SeoHeader title="Opportunities" site={site} conn={conn} range={null} compare={false} params={sp} pathname={pathname} showRange={false} />
      <ConnectionNotice site={site} conn={conn} />
      <div className="sk-enter flex flex-col gap-4">
        <Panel>
          <PanelHeader
            title="Work worth checking"
            description={`Rules run over the last ${t.windowDays} finalized days after every sync${window ? `: ${formatDayRange(window.from, window.to)}` : ""}`}
            meta={<Provenance source="gsc" detail={throughLabel(property.finalizedThrough)} />}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pb-3">
            <LinkTabs
              label="Status"
              items={OPPORTUNITY_STATUSES.map((s) => ({
                href: withParams(pathname, sp, { status: s === "new" ? null : s }),
                label: (
                  <>
                    {STATUS_LABELS[s]}
                    <span className="tnum ml-1.5 font-mono text-[11px] text-ink-3">{formatNumber(counts[s])}</span>
                  </>
                ),
                active: s === status,
              }))}
            />
            <LinkTabs
              label="Category"
              items={[
                { href: withParams(pathname, sp, { category: null }), label: "All", active: category === null },
                ...OPPORTUNITY_CATEGORIES.map((c) => ({ href: withParams(pathname, sp, { category: c }), label: CATEGORY_LABELS[c], active: c === category })),
              ]}
            />
          </div>
          {items.length ? (
            <ul>
              {items.map((o) => {
                const text = describe(o);
                const detail = `${base}/seo/${o.subjectType === "query" ? "queries" : "pages"}?${new URLSearchParams({ ...(sp.property ? { property: property.id } : {}), [o.subjectType]: o.subject })}`;
                return (
                  <li key={o.id} className="grid gap-x-6 gap-y-3 border-t border-line px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="text-[12px] leading-4 text-ink-3">
                        {CATEGORY_LABELS[o.category]} · {text.title}
                      </p>
                      <Link href={detail} className={o.subjectType === "page" ? "mt-1 block truncate rounded-sm font-mono text-[13px] leading-6 text-ink" : "mt-1 block truncate rounded-sm text-[15px] leading-6 font-medium text-ink"} title={o.subject}>
                        {o.subjectType === "page" ? pathOf(o.subject) : o.subject}
                      </Link>
                      <p className="tnum mt-1 max-w-[80ch] text-[13px] leading-5 text-ink-2">{text.evidence}</p>
                      <p className="mt-1 max-w-[80ch] text-[13px] leading-5 text-ink-3">{text.suggestion}</p>
                    </div>
                    <div className="flex flex-row items-center justify-between gap-4 md:flex-col md:items-end md:justify-start">
                      <p className="text-right">
                        <span className="tnum block text-[20px] leading-7 font-medium text-ink">{o.score}</span>
                        <span className="block text-[12px] leading-4 text-ink-3">priority</span>
                      </p>
                      <OpportunityActions siteId={site.id} id={o.id} status={o.status} subject={o.subject} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : unbuilt ? (
            <PanelEmpty title={`No ${CATEGORY_LABELS[category!].toLowerCase()} rules yet`}>
              {category === "technical" ? "Technical opportunities need site audits, which are not built yet" : "Performance opportunities need Lighthouse and CrUX data, which are not built yet"}
            </PanelEmpty>
          ) : (
            <PanelEmpty title={status === "new" ? "Nothing new was found" : `Nothing is ${STATUS_LABELS[status].toLowerCase()}`}>
              {status === "new" ? "No query or page crossed a rule's thresholds in the last 28 finalized days. Low-volume sites often have nothing here, and that is a real result" : "Items move here when you change their status"}
            </PanelEmpty>
          )}
        </Panel>

        <Panel className="p-5">
          <h2 className="text-[15px] leading-6 font-medium text-ink">How priority is calculated</h2>
          <p className="mt-1 max-w-[80ch] text-[13px] leading-5 text-ink-2">
            Priority orders the list from 0 to 100. It is not an estimate of traffic you would gain, and no rule predicts a result
          </p>
          <p className="mt-3 font-mono text-[12px] leading-5 text-ink">
            priority = 100 × confidence × ({SCORE_WEIGHTS.volume} × volume + {SCORE_WEIGHTS.gap} × gap + {SCORE_WEIGHTS.position} × position)
          </p>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] leading-5 md:grid-cols-2">
            {[
              ["Volume", "Impressions on a log scale, relative to the most-seen query or page"],
              ["Gap", "How far CTR sits below comparable queries, or the share of clicks lost. Not used for near-page-one items"],
              ["Position", "Closeness to the top results. Not used for declining pages"],
              ["Confidence", "Lower when there are few impressions, few weeks of data, or no single matching page"],
              ["Low CTR rule", `At least ${formatNumber(t.lowCtr.minImpressions)} impressions, position ${t.lowCtr.minPosition} to ${t.lowCtr.maxPosition}, CTR at least ${formatPercent(t.lowCtr.margin, 0)} below this site's other queries at the same position`],
              ["Near page one rule", `Position ${t.nearPageOne.minPosition} to ${t.nearPageOne.maxPosition}, at least ${formatNumber(t.nearPageOne.minImpressions)} impressions in ${t.nearPageOne.minWeeks} of 4 weeks, one page with ${formatPercent(t.nearPageOne.minPageShare, 0)} of impressions`],
              ["Declining clicks rule", `Down more than ${formatPercent(t.decliningClicks.minDrop, 0)} and at least ${t.decliningClicks.minAbsoluteDrop} clicks against the previous ${t.windowDays} days. Pages first seen during that period are skipped`],
              ["Not included", "Search volume, keyword difficulty and competitor data are not available from Search Console and are not shown"],
            ].map(([term, text]) => (
              <div key={term}>
                <dt className="text-ink">{term}</dt>
                <dd className="text-ink-2">{text}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </>
  );
}

export default function OpportunitiesPage({ params, searchParams }: PageProps<"/sites/[siteId]/seo/opportunities">) {
  return (
    <Suspense fallback={<ReportFallback title="Opportunities" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

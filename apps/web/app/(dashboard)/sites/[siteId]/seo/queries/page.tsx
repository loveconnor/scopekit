import { Panel, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { ConnectionNotice, SearchGate, SeoHeader, throughLabel } from "@/components/scopekit/seo";
import { SubjectDetail } from "@/components/scopekit/seo-detail";
import { SearchTable, TableSearch } from "@/components/scopekit/seo-table";
import { ReportFallback } from "@/components/scopekit/site-header";
import { Button } from "@/components/ui/button";
import { formatNumber, formatPercent } from "@/lib/format";
import { withParams, type SearchParams } from "@/lib/params";
import { isReady, loadSeoView, queryCoverage, searchTable } from "@/lib/seo";
import { getDb, gscPairs, gscSubjectTotals, gscTotals } from "@scopekit/db";
import { searchConsoleLink } from "@scopekit/seo";
import { Download, ExternalLink } from "honestui/icons";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Queries" };

const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, sp, view, conn, range, base } = await loadSeoView(params, searchParams);
  const pathname = `${base}/seo/queries`;
  if (!isReady(conn) || !range) {
    return (
      <>
        <SeoHeader title="Queries" conn={conn} range={null} compare={view.compare} params={sp} pathname={pathname} />
        <SearchGate site={site} conn={conn} />
      </>
    );
  }
  const property = conn.active;
  const db = getDb();
  const q = typeof sp.q === "string" ? sp.q : "";
  const selected = typeof sp.query === "string" ? sp.query : null;
  const [table, totals, detail] = await Promise.all([
    searchTable("query", property.id, range, view.compare, { search: q, sort: typeof sp.sort === "string" ? sp.sort : undefined, page: Number(sp.p ?? 1) }),
    gscTotals(db, property.id, range.from, range.to),
    selected
      ? Promise.all([gscSubjectTotals(db, "query", property.id, selected, range.from, range.to), gscPairs(db, "query", property.id, selected, range.from, range.to)])
      : null,
  ]);
  const coverage = await queryCoverage(property.id, range, totals);
  const through = throughLabel(property.finalizedThrough);
  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) if (typeof value === "string" && ["range", "from", "to", "compare", "q", "sort", "property"].includes(key)) exportQuery.set(key, value);
  exportQuery.set("format", "csv");

  return (
    <>
      <SeoHeader
        title="Queries"
        conn={conn}
        range={range}
        compare={view.compare}
        params={sp}
        pathname={pathname}
        actions={
          <Button variant="outline" size="sm" render={<a href={`/api/sites/${site.id}/seo/queries?${exportQuery}`} download />}>
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            Export CSV
          </Button>
        }
      />
      <ConnectionNotice site={site} conn={conn} />
      <div className="flex flex-col gap-4">
        {selected && detail ? (
          <SubjectDetail
            heading="Query"
            subject={selected}
            totals={detail[0]}
            through={through}
            closeHref={withParams(pathname, sp, { query: null })}
            actions={
              property.isDemo ? null : (
                <Button variant="outline" size="sm" render={<a href={searchConsoleLink(property.externalPropertyId, { query: selected })} target="_blank" rel="noreferrer" />}>
                  Search Console
                  <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
                  <span className="sr-only">Opens in a new tab</span>
                </Button>
              )
            }
            pairsTitle="Pages this query led to"
            pairs={detail[1]}
            pairHref={(key) => `${base}/seo/pages?${new URLSearchParams({ ...(sp.property ? { property: property.id } : {}), page: key })}`}
            pairDisplay={pathOf}
          />
        ) : null}
        <Panel className="sk-enter">
          <PanelHeader
            title={`${formatNumber(table.total)} ${table.total === 1 ? "query" : "queries"}`}
            meta={<Provenance source="gsc" detail={through} />}
          />
          <TableSearch pathname={pathname} params={sp} q={q} label="Search queries" />
          <SearchTable kind="query" rows={table.rows} sort={table.sort} page={table.page} pages={table.pages} compare={view.compare} pathname={pathname} params={sp} q={q} />
          {coverage.clickShare !== null ? (
            <p className="border-t border-line px-5 py-3 text-[12px] leading-4 text-ink-3">
              Named queries: {formatNumber(coverage.clicks)} of {formatNumber(totals.clicks)} clicks ({formatPercent(coverage.clickShare, 0)})
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}

export default function QueriesPage({ params, searchParams }: PageProps<"/sites/[siteId]/seo/queries">) {
  return (
    <Suspense fallback={<ReportFallback title="Queries" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

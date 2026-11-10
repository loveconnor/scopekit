import { Panel, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { ConnectionNotice, SearchGate, SeoHeader, throughLabel } from "@/components/scopekit/seo";
import { InspectButton } from "@/components/scopekit/seo-client";
import { SubjectDetail } from "@/components/scopekit/seo-detail";
import { SearchTable, TableSearch } from "@/components/scopekit/seo-table";
import { ReportFallback } from "@/components/scopekit/site-header";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { filterParam, withParams, type SearchParams } from "@/lib/params";
import { isReady, loadSeoView, searchTable, sitePathOf } from "@/lib/seo";
import { getDb, gscPairs, gscSubjectTotals } from "@scopekit/db";
import { searchConsoleLink } from "@scopekit/seo";
import { Download, ExternalLink } from "honestui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Search pages" };

const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, "") || "/";

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, sp, view, conn, range, base } = await loadSeoView(params, searchParams);
  const pathname = `${base}/seo/pages`;
  if (!isReady(conn) || !range) {
    return (
      <>
        <SeoHeader title="Search pages" site={site} conn={conn} range={null} compare={view.compare} params={sp} pathname={pathname} />
        <SearchGate site={site} conn={conn} />
      </>
    );
  }
  const property = conn.active;
  const db = getDb();
  const q = typeof sp.q === "string" ? sp.q : "";
  const selected = typeof sp.page === "string" ? sp.page : null;
  const [table, detail] = await Promise.all([
    searchTable("page", property.id, range, view.compare, { search: q, sort: typeof sp.sort === "string" ? sp.sort : undefined, page: Number(sp.p ?? 1) }),
    selected
      ? Promise.all([gscSubjectTotals(db, "page", property.id, selected, range.from, range.to), gscPairs(db, "page", property.id, selected, range.from, range.to)])
      : null,
  ]);
  const through = throughLabel(property.finalizedThrough);
  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) if (typeof value === "string" && ["range", "from", "to", "compare", "q", "sort", "property"].includes(key)) exportQuery.set(key, value);
  exportQuery.set("format", "csv");
  const sitePath = selected ? sitePathOf(site, selected) : null;
  const propertyQuery: Record<string, string> = sp.property ? { property: property.id } : {};

  return (
    <>
      <SeoHeader
        title="Search pages"
        site={site}
        conn={conn}
        range={range}
        compare={view.compare}
        params={sp}
        pathname={pathname}
        actions={
          <Button variant="outline" size="sm" render={<a href={`/api/sites/${site.id}/seo/pages?${exportQuery}`} download />}>
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            Export CSV
          </Button>
        }
      />
      <ConnectionNotice site={site} conn={conn} />
      <div className="flex flex-col gap-4">
        {selected && detail ? (
          <SubjectDetail
            heading="Page"
            subject={selected}
            mono
            totals={detail[0]}
            through={through}
            closeHref={withParams(pathname, sp, { page: null })}
            actions={
              <>
                {sitePath ? (
                  <Button variant="outline" size="sm" render={<Link href={`${base}/analytics?${new URLSearchParams({ [filterParam("page")]: sitePath })}`} />}>
                    Traffic for this page
                  </Button>
                ) : null}
                {property.isDemo ? null : (
                  <>
                    <InspectButton siteId={site.id} url={selected} label="Check index status" size="sm" then={`${base}/seo/indexing`} />
                    <Button variant="outline" size="sm" render={<a href={searchConsoleLink(property.externalPropertyId, { page: selected })} target="_blank" rel="noreferrer" />}>
                      Search Console
                      <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" />
                      <span className="sr-only">Opens in a new tab</span>
                    </Button>
                  </>
                )}
              </>
            }
            pairsTitle="Queries this page appeared for"
            pairsNote="From the top query and page pairs stored per day. Anonymized queries are missing here, so the list can add up to less than the page's totals"
            pairs={detail[1]}
            pairHref={(key) => `${base}/seo/queries?${new URLSearchParams({ ...propertyQuery, query: key })}`}
          />
        ) : null}
        <Panel className="sk-enter">
          <PanelHeader
            title={`${formatNumber(table.total)} ${table.total === 1 ? "page" : "pages"}`}
            description="Pages that appeared in Google Search, counted per page. Page figures and property totals are separate requests and are not interchangeable"
            meta={<Provenance source="gsc" detail={through} />}
          />
          <TableSearch pathname={pathname} params={sp} q={q} label="Search page URLs" />
          <SearchTable kind="page" rows={table.rows} sort={table.sort} page={table.page} pages={table.pages} compare={view.compare} pathname={pathname} params={sp} q={q} display={pathOf} />
        </Panel>
      </div>
    </>
  );
}

export default function SearchPagesPage({ params, searchParams }: PageProps<"/sites/[siteId]/seo/pages">) {
  return (
    <Suspense fallback={<ReportFallback title="Search pages" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

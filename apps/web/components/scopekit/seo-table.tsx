import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeChange, formatNumber, formatPercent, formatPosition } from "@/lib/format";
import { withParams, type SearchParams } from "@/lib/params";
import { metricsOf, type SearchTableRow } from "@/lib/seo";
import type { GscTableSort } from "@scopekit/db";
import { ArrowDown, ArrowUp } from "honestui/icons";
import Link from "next/link";
import { PanelEmpty } from "./panel";
import { ChangeText } from "./seo";

const COLUMNS: { key: GscTableSort; label: string; needsCompare?: boolean }[] = [
  { key: "clicks", label: "Clicks" },
  { key: "change", label: "Clicks vs previous", needsCompare: true },
  { key: "impressions", label: "Impressions" },
  { key: "ctr", label: "CTR" },
  { key: "position", label: "Avg. position" },
];

/** Search form that keeps the rest of the URL state. */
export function TableSearch({ pathname, params, q, label }: { pathname: string; params: SearchParams; q: string; label: string }) {
  return (
    <form action={pathname} className="flex items-center gap-2 px-5 pb-3">
      {Object.entries(params).flatMap(([key, value]) =>
        key === "q" || key === "p" ? [] : (Array.isArray(value) ? value : [value]).map((item) => (item ? <input key={`${key}:${item}`} type="hidden" name={key} value={item} /> : null)),
      )}
      <Input size="sm" type="search" name="q" defaultValue={q} aria-label={label} placeholder={label} className="max-w-[280px]" />
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
    </form>
  );
}

/** Query or page rows with clicks, impressions, CTR and impression-weighted position. */
export function SearchTable({
  kind,
  rows,
  sort,
  page,
  pages,
  compare,
  pathname,
  params,
  q,
  display,
}: {
  kind: "query" | "page";
  rows: SearchTableRow[];
  sort: GscTableSort;
  page: number;
  pages: number;
  compare: boolean;
  pathname: string;
  params: SearchParams;
  q: string;
  /** Shortens a row key for display, e.g. a full URL to its path. */
  display?: (key: string) => string;
}) {
  const columns = COLUMNS.filter((column) => compare || !column.needsCompare);
  if (!rows.length) {
    return (
      <PanelEmpty title={q ? `Nothing contains “${q}”` : kind === "query" ? "No queries in this range" : "No pages in this range"}>
        {q ? "Check the spelling or clear the search" : "Google reported no rows for these days. Days still being backfilled fill in as the sync reaches them"}
      </PanelEmpty>
    );
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-line text-[12px] text-ink-3">
              <th scope="col" className="h-10 pl-5 text-left font-normal">
                {kind === "query" ? "Query" : "Page"}
              </th>
              {columns.map((column) => {
                const active = sort === column.key;
                // Position sorts best first, which is ascending.
                const Arrow = column.key === "position" || column.key === "change" ? ArrowUp : ArrowDown;
                return (
                  <th key={column.key} scope="col" aria-sort={active ? (Arrow === ArrowUp ? "ascending" : "descending") : undefined} className="h-10 px-3 text-right font-normal whitespace-nowrap">
                    <Link
                      href={withParams(pathname, params, { sort: column.key, p: null })}
                      scroll={false}
                      className={active ? "inline-flex items-center gap-1 rounded-sm text-ink" : "inline-flex items-center gap-1 rounded-sm hover:text-ink"}
                    >
                      {column.label}
                      <Arrow size={12} strokeWidth={1.5} className={active ? "opacity-100" : "opacity-30"} aria-hidden="true" />
                      <span className="sr-only">{active ? "sorted" : "sort"}</span>
                    </Link>
                  </th>
                );
              })}
              {kind === "query" ? (
                <th scope="col" className="h-10 px-3 text-right font-normal">
                  Pages
                </th>
              ) : null}
              <th scope="col" className="h-10 pr-5 pl-3 text-left font-normal">
                <span className="sr-only">Opportunity</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const { ctr, position } = metricsOf(row);
              return (
                <tr key={row.key} className="border-b border-line transition-colors duration-150 ease-out last:border-0 hover:bg-raised">
                  <th scope="row" className="h-11 w-full max-w-0 pl-5 text-left font-normal">
                    <Link
                      href={withParams(pathname, params, { [kind]: row.key })}
                      scroll={false}
                      title={row.key}
                      className={kind === "page" ? "block truncate rounded-sm font-mono text-[12px] text-ink" : "block truncate rounded-sm text-ink"}
                    >
                      {display ? display(row.key) : row.key}
                    </Link>
                  </th>
                  <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(row.clicks)}</td>
                  {compare ? (
                    <td className="tnum h-11 px-3 text-right">
                      <ChangeText change={row.previous ? computeChange(row.clicks, row.previous.clicks) : null} />
                    </td>
                  ) : null}
                  <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(row.impressions)}</td>
                  <td className="tnum h-11 px-3 text-right text-ink-2">{formatPercent(ctr)}</td>
                  <td className="tnum h-11 px-3 text-right text-ink-2">{formatPosition(position)}</td>
                  {kind === "query" ? <td className="tnum h-11 px-3 text-right text-ink-2">{row.pages ? formatNumber(row.pages) : "–"}</td> : null}
                  <td className="h-11 pr-5 pl-3 text-[12px] whitespace-nowrap text-ink">{row.hasOpportunity ? "Opportunity" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          {page > 1 ? (
            <Button variant="outline" size="sm" render={<Link href={withParams(pathname, params, { p: page > 2 ? String(page - 1) : null })} scroll={false} />}>
              Previous
            </Button>
          ) : (
            <span />
          )}
          <span className="tnum text-[12px] leading-4 text-ink-3">
            Page {formatNumber(page)} of {formatNumber(pages)}
          </span>
          {page < pages ? (
            <Button variant="outline" size="sm" render={<Link href={withParams(pathname, params, { p: String(page + 1) })} scroll={false} />}>
              Next
            </Button>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </>
  );
}

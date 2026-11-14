"use client";

import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "honestui/icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge, type StatusKey } from "./status";

export type SiteRow = {
  id: string;
  name: string;
  hostname: string;
  isDemo: boolean;
  visitors: number | null;
  pageviews: number | null;
  sessions: number | null;
  /** Null when the site has no Search Console property with data. */
  searchClicks: number | null;
  audit: StatusKey;
  changeText: string | null;
  changeDirection: "up" | "down" | "flat" | null;
  status: StatusKey;
  lastActivity: string;
  lastActivityAt: number;
};

type SortKey = "name" | "visitors" | "pageviews" | "sessions" | "searchClicks" | "lastActivityAt";
const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Website" },
  { key: "visitors", label: "Visitors", numeric: true },
  { key: "pageviews", label: "Pageviews", numeric: true },
  { key: "sessions", label: "Sessions", numeric: true },
  { key: "searchClicks", label: "Search clicks", numeric: true },
];

export function SitesTable({ rows, showSearch = true }: { rows: SiteRow[]; showSearch?: boolean }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pageviews", dir: "desc" });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.hostname.includes(q)) : rows;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av ?? -1) - ((bv as number | null) ?? -1);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, query, sort]);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <div>
      {showSearch && rows.length > 5 ? (
        <div className="px-5 pb-3 [div:first-child>&]:pt-4">
          <Input
            size="sm"
            type="search"
            aria-label="Search websites"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-[240px]"
          />
        </div>
      ) : null}
      <div className="overflow-x-auto border-t border-line [div:first-child>&:first-child]:border-t-0">
        <table className="w-full min-w-[1040px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-3">
              {COLUMNS.map((column) => {
                const active = sort.key === column.key;
                const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("h-10 px-3 font-normal first:pl-5", column.numeric ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors duration-150 ease-out hover:text-ink",
                        active && "text-ink",
                      )}
                    >
                      {column.label}
                      <Arrow size={12} strokeWidth={1.5} className={active ? "opacity-100" : "opacity-0"} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="h-10 px-3 text-right font-normal">
                Pageviews vs previous
              </th>
              <th scope="col" className="h-10 px-3 text-left font-normal">
                Audit
              </th>
              <th scope="col" className="h-10 px-3 text-left font-normal">
                Tracking
              </th>
              <th scope="col" className="h-10 px-3 pr-5 text-right font-normal">
                Last event
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="group border-b border-line transition-colors duration-150 ease-out last:border-0 hover:bg-raised">
                <th scope="row" className="h-12 px-3 pl-5 text-left font-normal">
                  <Link href={`/sites/${row.id}/overview`} className="flex min-w-0 flex-col rounded-sm">
                    <span className="truncate font-medium text-ink">
                      {row.name}
                      {row.isDemo ? <span className="ml-2 rounded-[4px] border border-line px-1 font-mono text-[11px] leading-4 text-ink-3 font-normal">demo</span> : null}
                    </span>
                    <span className="truncate font-mono text-[11px] leading-4 text-ink-3">{row.hostname}</span>
                  </Link>
                </th>
                <td className="tnum h-12 px-3 text-right text-ink">{formatNumber(row.visitors)}</td>
                <td className="tnum h-12 px-3 text-right text-ink">{formatNumber(row.pageviews)}</td>
                <td className="tnum h-12 px-3 text-right text-ink">{formatNumber(row.sessions)}</td>
                <td className="tnum h-12 px-3 text-right text-ink">
                  {row.searchClicks === null ? <span className="text-[12px] whitespace-nowrap text-ink-3">Not connected</span> : formatNumber(row.searchClicks)}
                </td>
                <td
                  className={cn(
                    "tnum h-12 px-3 text-right",
                    row.changeDirection === "up" ? "text-positive" : row.changeDirection === "down" ? "text-negative" : "text-ink-3",
                  )}
                >
                  {row.changeText ?? "–"}
                </td>
                <td className="h-12 px-3">
                  <StatusBadge status={row.audit} className="whitespace-nowrap" />
                </td>
                <td className="h-12 px-3">
                  <StatusBadge status={row.status} className="whitespace-nowrap" />
                </td>
                <td className="h-12 px-3 pr-5 text-right text-ink-2">{row.lastActivity}</td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="h-12 px-5 text-ink-2">
                  No website matches “{query}”
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

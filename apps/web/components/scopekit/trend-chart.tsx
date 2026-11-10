"use client";

import { formatCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LineChart, type ChartConfig } from "honestui/charts";
import { useMemo, useState } from "react";

/** Series are told apart by ink, gray and dashes rather than by hue. */
export type TrendSeries = { key: string; label: string; light: string; dark: string; emphasis?: boolean; dashed?: boolean };
export type TrendRow = { label: string; longLabel: string; status?: string; note?: string } & Record<string, string | number | null | undefined>;

const STATUS_TEXT = {
  statuses: {
    provisional: { label: "In progress", description: "This period is not finished, so the value will still rise." },
    estimated: { label: "Estimated", description: "Calculated from limited signals, not counted exactly." },
  },
};

/**
 * The main chart on a screen, with an equivalent table one click away so values are
 * reachable without a pointer. Unfinished periods are drawn as provisional, never as a drop.
 */
export function TrendChart({
  rows,
  series,
  ariaLabel,
  height = 300,
  statusKey = "status",
}: {
  rows: TrendRow[];
  series: TrendSeries[];
  ariaLabel: string;
  height?: number;
  statusKey?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const config = useMemo(
    () => Object.fromEntries(series.map((s) => [s.key, { label: s.label, colors: { light: [s.light], dark: [s.dark] } }])) satisfies ChartConfig,
    [series],
  );
  const everyNth = Math.max(1, Math.ceil(rows.length / 8));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 px-5">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-[12px] leading-4 text-ink-2">
              <span aria-hidden="true" className="w-3.5 border-t-2 dark:hidden" style={{ borderColor: s.light, borderStyle: s.dashed ? "dashed" : "solid" }} />
              <span aria-hidden="true" className="hidden w-3.5 border-t-2 dark:block" style={{ borderColor: s.dark, borderStyle: s.dashed ? "dashed" : "solid" }} />
              {s.label}
            </li>
          ))}
        </ul>
        <div role="group" aria-label="Chart or table" className="flex shrink-0 items-center gap-1 text-[12px]">
          {(["chart", "table"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "h-6 cursor-pointer rounded-sm px-2 transition-colors duration-150 ease-out",
                view === option ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {option === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {view === "chart" ? (
        <div style={{ height }} className="px-2">
          <LineChart
            data={rows}
            config={config}
            xDataKey="label"
            curveType="linear"
            animation={false}
            className="h-full w-full"
            ariaLabel={ariaLabel}
            dataStatusText={STATUS_TEXT}
          >
            <LineChart.Grid />
            <LineChart.XAxis dataKey="label" tickFormatter={(value, index) => (index % everyNth === 0 ? value : "")} />
            <LineChart.YAxis tickFormatter={(value) => formatCompact(value)} />
            <LineChart.Tooltip />
            {series.map((s) => (
              <LineChart.Line
                key={s.key}
                dataKey={s.key}
                // The chart draws per-point status as dashes and then keeps the line solid, so a dashed series leaves status to the others.
                statusKey={s.dashed ? undefined : statusKey}
                strokeWidth={s.emphasis === false ? 1.5 : 2}
                strokeVariant={s.dashed ? "dashed" : "solid"}
              >
                <LineChart.ActiveDot variant="colored-border" />
              </LineChart.Line>
            ))}
          </LineChart>
        </div>
      ) : (
        <div style={{ height }} className="overflow-auto px-5">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">{ariaLabel}</caption>
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th scope="col" className="h-9 pr-4 font-normal">
                  Period
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="h-9 pl-4 text-right font-normal">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.longLabel} className="border-b border-line last:border-0">
                  <th scope="row" className="h-9 pr-4 text-left font-normal text-ink-2">
                    {row.longLabel}
                    {row[statusKey] === "provisional" ? <span className="ml-2 text-[12px] text-ink-3">in progress</span> : null}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="tnum h-9 pl-4 text-right text-ink">
                      {typeof row[s.key] === "number" ? formatNumber(row[s.key] as number) : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

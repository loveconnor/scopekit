import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber, type Change } from "@/lib/format";
import { cn } from "@/lib/utils";
import { METRIC_DEFINITIONS, type MetricKey } from "@scopekit/analytics";
import type { DataSource } from "@scopekit/contracts";
import type { ReactNode } from "react";
import { Panel } from "./panel";
import { Provenance } from "./provenance";

/** Metric name with its definition and caveat on hover or focus. */
export function MetricLabel({ metric, label, className }: { metric: MetricKey; label?: string; className?: string }) {
  const def = METRIC_DEFINITIONS[metric];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "cursor-help rounded-sm text-left underline decoration-line decoration-dotted underline-offset-4",
              className,
            )}
          />
        }
      >
        {label ?? def.label}
      </TooltipTrigger>
      <TooltipPopup className="max-w-[280px]">
        <span className="block text-[12px] leading-4">{def.definition}</span>
        <span className="mt-1 block text-[12px] leading-4 opacity-70">{def.caveat}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

export type KpiProps = {
  label: ReactNode;
  /** Number to show, or null when there is no value. `unavailable` then says why. */
  value: number | string | null;
  /** Shown instead of a number, e.g. "Not connected". Never a zero. */
  unavailable?: { text: string; reason: string };
  change?: Change | null;
  /** Absolute difference against the comparison period. */
  delta?: number | null;
  comparedTo?: string;
  /** A plain second line, for figures that have context but no comparison. */
  note?: string;
  /** Whether an increase is good news for this metric. */
  upIsGood?: boolean;
  source: DataSource;
  sourceDetail?: string | null;
};

export function Kpi({ label, value, unavailable, change, delta, comparedTo, note, upIsGood = true, source, sourceDetail }: KpiProps) {
  const good = change ? (change.direction === "up") === upIsGood : false;
  return (
    <Panel className="flex min-h-[136px] flex-col p-5">
      <div className="text-[13px] leading-5 text-ink-2">{label}</div>
      {value === null && unavailable ? (
        <>
          <p className="mt-2 text-[16px] leading-8 font-medium text-ink-2">{unavailable.text}</p>
          <p className="text-[12px] leading-4 text-ink-3">{unavailable.reason}</p>
        </>
      ) : (
        <>
          <p className="tnum mt-2 text-[28px] leading-8 font-medium text-ink">
            {typeof value === "number" ? formatNumber(value) : value}
          </p>
          <p className="tnum mt-1 min-h-4 text-[12px] leading-4 text-ink-3">
            {change ? (
              <>
                <span className={cn(change.direction === "flat" ? "text-ink-2" : good ? "text-positive" : "text-negative")}>
                  {delta !== null && delta !== undefined ? `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${formatNumber(Math.abs(delta))} (${change.text})` : change.text}
                </span>{" "}
                {comparedTo}
              </>
            ) : note ? (
              note
            ) : comparedTo ? (
              `No earlier data ${comparedTo.replace(/^vs (previous )?/, (_m, previous: string | undefined) => (previous ? "for the previous " : "for "))}`
            ) : null}
          </p>
        </>
      )}
      <Provenance source={source} detail={sourceDetail} className="mt-auto pt-3" />
    </Panel>
  );
}

export function KpiRow({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 | 6 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-4",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "xl:grid-cols-4",
        columns === 6 && "md:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

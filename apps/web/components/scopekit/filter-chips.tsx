import { countryName, deviceLabel } from "@/lib/format";
import { FILTER_LABELS, filterParam, withParams, type SearchParams, type ViewState } from "@/lib/params";
import type { FilterDimension } from "@scopekit/contracts";
import { X } from "honestui/icons";
import Link from "next/link";

export function filterValueLabel(dimension: FilterDimension, value: string): string {
  if (dimension === "country") return value === "Unknown" ? "Unknown" : countryName(value);
  if (dimension === "device") return deviceLabel(value);
  if (dimension === "source" && value === "(direct)") return "Direct / unknown";
  if ((dimension === "referrer" || dimension === "campaign") && value === "") return "None";
  return value;
}

/** Href that adds one filter value to the current view. */
export function addFilterHref(pathname: string, params: SearchParams, dimension: FilterDimension, value: string): string {
  return withParams(pathname, params, { [filterParam(dimension)]: value, cursor: null });
}

/** Active filters. Rules on different dimensions combine with AND; filtered views read raw events. */
export function FilterChips({ pathname, params, view }: { pathname: string; params: SearchParams; view: ViewState }) {
  if (!view.hasFilters) return null;
  const entries = Object.entries(view.filters) as [FilterDimension, string[]][];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-[12px] leading-4 text-ink-3">Filtered by</span>
      {entries.flatMap(([dimension, values]) =>
        values.map((value) => (
          <Link
            key={`${dimension}:${value}`}
            href={withParams(pathname, params, { [filterParam(dimension)]: values.filter((v) => v !== value), cursor: null })}
            className="group inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface pr-1.5 pl-2 text-[12px] leading-4 text-ink transition-colors duration-150 ease-out hover:bg-raised"
          >
            <span className="text-ink-3">{FILTER_LABELS[dimension]}</span>
            <span className="max-w-[220px] truncate font-mono text-[11px]">{filterValueLabel(dimension, value)}</span>
            <X size={12} strokeWidth={1.5} className="text-ink-3 group-hover:text-ink" aria-hidden="true" />
            <span className="sr-only">Remove filter</span>
          </Link>
        )),
      )}
      <Link
        href={withParams(pathname, params, Object.fromEntries(entries.map(([d]) => [filterParam(d), null])))}
        className="rounded-sm px-1 text-[12px] leading-4 text-ink-2 underline decoration-line underline-offset-4 hover:text-ink"
      >
        Clear all
      </Link>
    </div>
  );
}

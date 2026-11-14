import { cn } from "@/lib/utils";
import type { DataSource } from "@scopekit/contracts";

const SOURCE_LABELS: Record<DataSource, string> = {
  scopekit: "ScopeKit",
  gsc: "Search Console",
  lighthouse: "Lighthouse",
  crux: "CrUX",
};

/**
 * The provenance tag. Every figure in the product says where it came from and how fresh it
 * is, in the same small mono line, so observed traffic is never mistaken for search data,
 * lab results or estimates.
 */
export function Provenance({
  source,
  detail,
  className,
}: {
  source: DataSource;
  /** Freshness or qualifier, e.g. "through Nov 8" or "estimated". */
  detail?: string | null;
  className?: string;
}) {
  // ScopeKit is the default source: its tag only shows when it carries a fact.
  if (source === "scopekit" && !detail) return null;
  return (
    <span className={cn("inline-flex items-start gap-1.5 font-mono text-[11px] leading-4 text-ink-3", className)}>
      <span aria-hidden="true" className="mt-[5px] size-1.5 shrink-0 rounded-[1px] bg-current opacity-70" />
      <span>
        {SOURCE_LABELS[source]}
        {detail ? ` · ${detail}` : ""}
      </span>
    </span>
  );
}

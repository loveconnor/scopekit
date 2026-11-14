import type { ResolvedRange } from "@scopekit/analytics";
import { PageHeader } from "./page-header";
import { KpiSkeletonRow, PanelSkeleton } from "./panel";
import { RangeControl } from "./range-control";

/** Header for a site report: title and range controls. */
export function SiteReportHeader({
  title,
  range,
  compare,
  allowHourly = true,
  actions,
}: {
  title: string;
  range: ResolvedRange;
  compare: boolean;
  allowHourly?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      actions={
        <>
          <RangeControl preset={range.preset} from={range.from} to={range.to} compare={compare} allowHourly={allowHourly} />
          {actions}
        </>
      }
    />
  );
}

export function ReportFallback({ title, kpis = 4 }: { title: string; kpis?: number }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="flex flex-col gap-4">
        {kpis ? <KpiSkeletonRow count={kpis} /> : null}
        <PanelSkeleton height={300} />
      </div>
    </>
  );
}

/** Shown when a view reads raw events, so its limits are stated next to the numbers. */
export function RawEventsNote({ retentionDays, truncated, filtered }: { retentionDays: number; truncated: boolean; filtered: boolean }) {
  return (
    <p className="text-[12px] leading-4 text-ink-3">
      {filtered ? "Filtered" : "Hourly"} views are computed from raw events, which are kept for {retentionDays} days
      {filtered ? ". Engagement and goal figures need whole sessions and are left out" : ""}
      {truncated ? ". This range starts before the oldest retained event, so earlier days are missing" : ""}
    </p>
  );
}

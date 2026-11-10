import { computeChange, formatDateTime, formatDay, formatDayLong, formatDayRange, formatHour } from "@/lib/format";
import type { SiteReport } from "@/lib/reports";
import type { TrendRow } from "./trend-chart";

/** Shared wording for a site report: range label, comparison label and provenance detail. */
export function reportLabels(report: SiteReport, timezone: string) {
  const { range, meta } = report;
  const hourly = range.granularity === "hour";
  const rangeLabel = range.preset === "24h" ? "Last 24 hours" : range.preset === "today" ? `Today, ${formatDayLong(range.from)}` : formatDayRange(range.from, range.to);
  const comparedTo =
    range.preset === "24h"
      ? "vs previous 24 hours"
      : range.preset === "today"
        ? "vs yesterday by this time"
        : range.days === 1
          ? "vs previous day"
          : `vs previous ${range.days} days`;
  const through = !meta.freshThrough
    ? "no events in range"
    : range.includesToday
      ? `through ${formatDateTime(meta.freshThrough, timezone)}`
      : `through ${formatDay(range.to)}`;
  return { rangeLabel, comparedTo, through, hourly };
}

export function trendRows(report: SiteReport, timezone: string): TrendRow[] {
  const hourly = report.range.granularity === "hour";
  return report.series.map((point) => ({
    label: hourly ? formatHour(point.bucket, timezone) : formatDay(point.bucket),
    longLabel: hourly ? formatDateTime(point.bucket, timezone) : formatDayLong(point.bucket),
    status: point.status === "provisional" ? "provisional" : undefined,
    pageviews: point.pageviews,
    sessions: point.sessions,
    visitors: point.visitors,
  }));
}

export const change = computeChange;

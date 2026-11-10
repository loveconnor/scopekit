const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** One number format across the product: grouped integers, never abbreviated in tables or KPIs. */
export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : number.format(value);
}

/** Axis ticks only. */
export function formatCompact(value: number): string {
  return compact.format(value);
}

export function formatPercent(ratio: number | null, digits = 1): string {
  if (ratio === null || !Number.isFinite(ratio)) return "–";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatRatio(numerator: number, denominator: number, digits = 2): string {
  if (!denominator) return "–";
  return (numerator / denominator).toFixed(digits);
}

export type Change = { text: string; direction: "up" | "down" | "flat" };

/** Relative change against the previous period. Null when there is nothing to compare against. */
export function computeChange(current: number | null, previous: number | null | undefined): Change | null {
  if (current === null || previous === null || previous === undefined || previous === 0) return null;
  const delta = (current - previous) / previous;
  if (Math.abs(delta) < 0.0005) return { text: "0.0%", direction: "flat" };
  return { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)}%`, direction: delta > 0 ? "up" : "down" };
}

const asUtc = (date: string) => new Date(`${date}T12:00:00Z`);
const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** `2026-11-08` -> `Nov 8`. Calendar dates carry no timezone, so they are formatted as-is. */
export function formatDay(date: string): string {
  return monthDay.format(asUtc(date));
}

export function formatDayLong(date: string): string {
  return monthDayYear.format(asUtc(date));
}

export function formatDayRange(from: string, to: string): string {
  if (from === to) return formatDayLong(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${formatDay(from)} – ${formatDayLong(to)}` : `${formatDayLong(from)} – ${formatDayLong(to)}`;
}

export function formatDateTime(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatHour(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone }).format(new Date(iso));
}

export function formatRelative(iso: string | Date | null | undefined, now: number): string {
  if (!iso) return "Never";
  const then = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "Unknown";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const DEVICE_LABELS: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablet", unknown: "Unknown" };
export const deviceLabel = (value: string) => DEVICE_LABELS[value] ?? value;

/** Average position to one decimal. Position 1 is the top result. */
export function formatPosition(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "–" : value.toFixed(1);
}

/** Change in average position. A lower number is better, so a negative delta is an improvement. */
export function positionChange(current: number | null, previous: number | null | undefined): Change | null {
  if (current === null || previous === null || previous === undefined) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.05) return { text: "0.0", direction: "flat" };
  return { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`, direction: delta > 0 ? "up" : "down" };
}

/** Change in a ratio, in percentage points. */
export function pointChange(current: number | null, previous: number | null | undefined): Change | null {
  if (current === null || previous === null || previous === undefined) return null;
  const delta = (current - previous) * 100;
  if (Math.abs(delta) < 0.05) return { text: "0.0 pts", direction: "flat" };
  return { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} pts`, direction: delta > 0 ? "up" : "down" };
}

import { addDays, daysInclusive, isValidDate } from "@scopekit/analytics";
import type { RangePreset } from "@scopekit/contracts";

export type GscMetrics = { clicks: number; impressions: number; positionNumerator: number };

/** Total clicks over total impressions. Never an average of daily CTRs. */
export const ctrOf = (m: Pick<GscMetrics, "clicks" | "impressions">): number | null => (m.impressions > 0 ? m.clicks / m.impressions : null);

/** Impression-weighted average position. Never an average of daily positions. */
export const positionOf = (m: Pick<GscMetrics, "impressions" | "positionNumerator">): number | null =>
  m.impressions > 0 ? m.positionNumerator / m.impressions : null;

/** Turns an API row (average position) into storable metrics (position x impressions). */
export function toStored(row: { clicks: number; impressions: number; position: number }): GscMetrics {
  const impressions = Math.round(row.impressions);
  return { clicks: Math.round(row.clicks), impressions, positionNumerator: row.position * impressions };
}

export function sumMetrics(rows: Iterable<GscMetrics>): GscMetrics {
  const total = { clicks: 0, impressions: 0, positionNumerator: 0 };
  for (const row of rows) {
    total.clicks += row.clicks;
    total.impressions += row.impressions;
    total.positionNumerator += row.positionNumerator;
  }
  return total;
}

export type GscRange = {
  preset: RangePreset;
  /** Inclusive Pacific Time dates. */
  from: string;
  to: string;
  days: number;
  previous: { from: string; to: string };
  /** The requested end was after the last finalized day, so the range was pulled back. */
  clamped: boolean;
};

const PRESET_DAYS: Partial<Record<RangePreset, number>> = { "7d": 7, "30d": 30, "90d": 90 };
const MAX_DAYS = 486;

/**
 * Search ranges always end on a finalized day and compare against the equally long
 * finalized period before it. `today` and `24h` have no meaning for data that lags by days,
 * so they fall back to the default preset.
 */
export function resolveGscRange(input: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  finalizedThrough: string;
  fallbackPreset?: "7d" | "30d" | "90d";
}): GscRange {
  const finalized = input.finalizedThrough;
  let preset = (input.preset ?? input.fallbackPreset ?? "30d") as RangePreset;
  let from: string;
  let to: string;
  let clamped = false;
  if (preset === "custom" && isValidDate(input.from) && isValidDate(input.to) && input.from <= input.to) {
    clamped = input.to > finalized;
    to = clamped ? finalized : input.to;
    from = input.from > to ? to : input.from;
    if (daysInclusive(from, to) > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  } else {
    if (!(preset in PRESET_DAYS)) preset = input.fallbackPreset ?? "30d";
    to = finalized;
    from = addDays(to, -(PRESET_DAYS[preset]! - 1));
  }
  const days = daysInclusive(from, to);
  const previousTo = addDays(from, -1);
  return { preset, from, to, days, previous: { from: addDays(previousTo, -(days - 1)), to: previousTo }, clamped };
}

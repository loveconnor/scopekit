import type { RangePreset } from "@scopekit/contracts";

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(instant: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Calendar date (`YYYY-MM-DD`) an instant falls on in the given timezone. */
export function localDateOf(instant: Date, timeZone: string): string {
  return zonedParts(instant, timeZone).date;
}

export function localHourOf(instant: Date, timeZone: string): number {
  return zonedParts(instant, timeZone).hour;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of calendar days from `from` to `to`. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * UTC instant at which a local calendar day starts. Days around a DST change are 23 or 25
 * hours long, so day bounds must come from here rather than from adding 24 hours.
 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = zonedParts(new Date(guess), timeZone);
    const shown = Date.parse(`${parts.date}T00:00:00Z`) + ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000;
    const diff = shown - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function isValidDate(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export type ResolvedRange = {
  preset: RangePreset;
  /** Inclusive local calendar dates. */
  from: string;
  to: string;
  days: number;
  granularity: "hour" | "day";
  /** UTC bounds, `[start, end)`. */
  start: Date;
  end: Date;
  /** True when the range includes the current, unfinished day. */
  includesToday: boolean;
  previous: { from: string; to: string; start: Date; end: Date };
};

const PRESET_DAYS: Partial<Record<RangePreset, number>> = { "7d": 7, "30d": 30, "90d": 90 };
export const MAX_RANGE_DAYS = 366;

/**
 * Default ranges cover complete local days only, so the newest point is never a partial day.
 * `today` and `24h` are the explicit ways to look at in-progress data.
 */
export function resolveRange(input: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  timeZone: string;
  now?: Date;
}): ResolvedRange {
  const now = input.now ?? new Date();
  const tz = input.timeZone;
  const today = localDateOf(now, tz);
  let preset = (input.preset ?? "30d") as RangePreset;

  if (preset === "24h") {
    const end = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
    const start = new Date(end.getTime() - 24 * 3_600_000);
    return {
      preset,
      from: localDateOf(start, tz),
      to: today,
      days: 1,
      granularity: "hour",
      start,
      end,
      includesToday: true,
      previous: {
        from: localDateOf(new Date(start.getTime() - 24 * 3_600_000), tz),
        to: localDateOf(new Date(start.getTime() - 1), tz),
        start: new Date(start.getTime() - 24 * 3_600_000),
        end: start,
      },
    };
  }

  let from: string;
  let to: string;
  if (preset === "today") {
    from = to = today;
  } else if (preset === "custom" && isValidDate(input.from) && isValidDate(input.to) && input.from <= input.to) {
    to = input.to > today ? today : input.to;
    from = input.from > to ? to : input.from;
    if (daysInclusive(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  } else {
    if (!(preset in PRESET_DAYS)) preset = "30d";
    to = addDays(today, -1);
    from = addDays(to, -(PRESET_DAYS[preset]! - 1));
  }

  const days = daysInclusive(from, to);
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -(days - 1));
  return {
    preset,
    from,
    to,
    days,
    granularity: preset === "today" ? "hour" : "day",
    start: startOfLocalDay(from, tz),
    end: startOfLocalDay(addDays(to, 1), tz),
    includesToday: to >= today,
    previous:
      preset === "today"
        ? {
            // An unfinished day is compared with yesterday up to the same time of day.
            from: previousFrom,
            to: previousTo,
            start: startOfLocalDay(previousFrom, tz),
            end: new Date(startOfLocalDay(previousFrom, tz).getTime() + (now.getTime() - startOfLocalDay(from, tz).getTime())),
          }
        : {
            from: previousFrom,
            to: previousTo,
            start: startOfLocalDay(previousFrom, tz),
            end: startOfLocalDay(from, tz),
          },
  };
}

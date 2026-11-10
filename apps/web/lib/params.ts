import { FILTER_DIMENSIONS, RANGE_PRESETS, type AnalyticsFilters, type FilterDimension, type RangePreset } from "@scopekit/contracts";

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const all = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export type ViewState = {
  range: { preset: RangePreset | null; from: string | null; to: string | null };
  compare: boolean;
  filters: AnalyticsFilters;
  hasFilters: boolean;
};

export const filterParam = (dimension: FilterDimension) => `f_${dimension}`;

/** Everything a report needs lives in the URL, so a reload or a shared link shows the same view. */
export function parseViewState(params: SearchParams): ViewState {
  const rawPreset = first(params.range);
  const preset = RANGE_PRESETS.includes(rawPreset as RangePreset) ? (rawPreset as RangePreset) : null;
  const filters: AnalyticsFilters = {};
  for (const dimension of FILTER_DIMENSIONS) {
    const values = all(params[filterParam(dimension)])
      .map((value) => value.slice(0, 300))
      .filter(Boolean)
      .slice(0, 10);
    if (values.length) filters[dimension] = values;
  }
  return {
    range: { preset, from: first(params.from) ?? null, to: first(params.to) ?? null },
    compare: first(params.compare) !== "0",
    filters,
    hasFilters: Object.keys(filters).length > 0,
  };
}

/** Builds an href that keeps the current view and applies `patch`. `null` or `[]` removes a key. */
export function withParams(pathname: string, current: SearchParams, patch: Record<string, string | string[] | null>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (key in patch) continue;
    for (const item of all(value)) next.append(key, item);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) next.append(key, item);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Keeps only the view keys (range, comparison, filters) when moving between report pages. */
export function viewQuery(current: SearchParams): string {
  const next = new URLSearchParams();
  for (const key of ["range", "from", "to", "compare", ...FILTER_DIMENSIONS.map(filterParam)]) {
    for (const item of all(current[key])) next.append(key, item);
  }
  const query = next.toString();
  return query ? `?${query}` : "";
}

export const FILTER_LABELS: Record<FilterDimension, string> = {
  page: "Page",
  referrer: "Referrer",
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
  country: "Country",
  device: "Device",
  browser: "Browser",
};

/** Cookie that remembers the last range and comparison picked, across pages and visits. */
export const VIEW_COOKIE = "scopekit.view";
export const RANGE_KEYS = ["range", "from", "to", "compare"] as const;

/**
 * Fills in the range and comparison from the saved choice when the URL has none. A URL that
 * names a range always wins, so shared links show exactly what they say.
 */
export function withSavedView(params: SearchParams, saved: string | undefined): SearchParams {
  if (!saved) return params;
  let stored: URLSearchParams;
  try {
    stored = new URLSearchParams(saved);
  } catch {
    return params;
  }
  const next: SearchParams = { ...params };
  const hasRange = params.range !== undefined || params.from !== undefined || params.to !== undefined;
  if (!hasRange) {
    for (const key of ["range", "from", "to"] as const) {
      const value = stored.get(key);
      if (value) next[key] = value.slice(0, 20);
    }
  }
  if (params.compare === undefined && stored.get("compare") === "0") next.compare = "0";
  return next;
}

/** Saves the range and comparison of a query string in the view cookie (browser only). */
export function saveViewCookie(query: URLSearchParams) {
  const saved = new URLSearchParams();
  for (const key of RANGE_KEYS) {
    const value = query.get(key);
    if (value) saved.set(key, value);
  }
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${VIEW_COOKIE}=${encodeURIComponent(saved.toString())}; path=/; max-age=31536000; samesite=lax${secure}`;
}

import type { CruxFormFactor, LabMetrics, LabOpportunity, LabScores, PerfDevice } from "@scopekit/contracts";

export type PerformanceConfig = { apiKey: string; psiUrl: string; cruxUrl: string };

/**
 * Null until GOOGLE_API_KEY is set. PageSpeed Insights and the Chrome UX Report are public
 * APIs keyed by one Google API key; no user data or OAuth is involved.
 */
export function performanceConfigFromEnv(env: Record<string, string | undefined> = process.env): PerformanceConfig | null {
  if (!env.GOOGLE_API_KEY) return null;
  const base = env.SCOPEKIT_GOOGLE_BASE_URL?.replace(/\/$/, "");
  return {
    apiKey: env.GOOGLE_API_KEY,
    psiUrl: base ? `${base}/pagespeedonline/v5/runPagespeed` : "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
    cruxUrl: base ? `${base}/v1/records:queryHistoryRecord` : "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord",
  };
}

export class ProviderError extends Error {
  constructor(
    public kind: "rate_limit" | "unavailable" | "rejected",
    message: string,
  ) {
    super(message);
  }
}

async function providerFetch(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ProviderError("unavailable", "The provider did not answer in time");
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 429) throw new ProviderError("rate_limit", "The provider's quota is used up for now");
  if (response.status >= 500) throw new ProviderError("unavailable", `The provider returned ${response.status}`);
  return { status: response.status, body };
}

/* ------------------------------ PageSpeed Insights ------------------------------ */

type Audit = { title?: string; score?: number | null; numericValue?: number; details?: { type?: string; overallSavingsMs?: number; overallSavingsBytes?: number }; metricSavings?: Record<string, number> };
type LighthouseResult = {
  lighthouseVersion?: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  fetchTime?: string;
  runtimeError?: { code?: string; message?: string };
  categories?: Record<string, { score?: number | null }>;
  audits?: Record<string, Audit>;
};

export type LabResult = {
  finalUrl: string | null;
  lighthouseVersion: string | null;
  checkedAt: Date;
  scores: LabScores;
  metrics: LabMetrics;
  opportunities: LabOpportunity[];
  raw: Record<string, unknown>;
};

const score = (value: number | null | undefined) => (typeof value === "number" ? Math.round(value * 100) : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const SCREENSHOT_AUDITS = ["final-screenshot", "screenshot-thumbnails", "full-page-screenshot"];

/** Reduces a PageSpeed response to what is stored. Values are passed through as the provider returned them. */
export function parseLighthouse(result: LighthouseResult): LabResult {
  const audits = result.audits ?? {};
  const metric = (id: string) => num(audits[id]?.numericValue);
  const opportunities: LabOpportunity[] = [];
  for (const [id, audit] of Object.entries(audits)) {
    if (typeof audit.score !== "number" || audit.score >= 0.9 || !audit.title) continue;
    const savingsMs = num(audit.details?.overallSavingsMs) ?? (audit.metricSavings ? Math.max(0, ...Object.values(audit.metricSavings).filter((v) => typeof v === "number")) : null);
    const savingsBytes = num(audit.details?.overallSavingsBytes);
    // Only audits for which Lighthouse itself estimated a saving are listed.
    if (!(savingsMs && savingsMs > 0) && !(savingsBytes && savingsBytes > 0)) continue;
    opportunities.push({ id, title: audit.title.slice(0, 200), savingsMs: savingsMs && savingsMs > 0 ? Math.round(savingsMs) : null, savingsBytes: savingsBytes && savingsBytes > 0 ? Math.round(savingsBytes) : null });
  }
  opportunities.sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || (b.savingsBytes ?? 0) - (a.savingsBytes ?? 0));
  const fetched = result.fetchTime ? new Date(result.fetchTime) : new Date();
  return {
    finalUrl: result.finalDisplayedUrl ?? result.finalUrl ?? null,
    lighthouseVersion: result.lighthouseVersion ?? null,
    checkedAt: Number.isNaN(fetched.getTime()) ? new Date() : fetched,
    scores: {
      performance: score(result.categories?.performance?.score),
      accessibility: score(result.categories?.accessibility?.score),
      bestPractices: score(result.categories?.["best-practices"]?.score),
      seo: score(result.categories?.seo?.score),
    },
    metrics: {
      fcp: metric("first-contentful-paint"),
      lcp: metric("largest-contentful-paint"),
      speedIndex: metric("speed-index"),
      tbt: metric("total-blocking-time"),
      cls: metric("cumulative-layout-shift"),
    },
    opportunities: opportunities.slice(0, 8),
    raw: { ...result, audits: Object.fromEntries(Object.entries(audits).filter(([id]) => !SCREENSHOT_AUDITS.includes(id))) } as Record<string, unknown>,
  };
}

export async function runPageSpeed(config: PerformanceConfig, url: string, device: PerfDevice): Promise<LabResult> {
  const params = new URLSearchParams({ url, strategy: device === "mobile" ? "MOBILE" : "DESKTOP", key: config.apiKey });
  for (const category of ["PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO"]) params.append("category", category);
  const { status, body } = await providerFetch(`${config.psiUrl}?${params}`, { method: "GET" }, 90_000);
  const lighthouse = body?.lighthouseResult as LighthouseResult | undefined;
  if (status !== 200 || !lighthouse) {
    const message = (body?.error as { message?: string } | undefined)?.message;
    throw new ProviderError("rejected", message ? message.slice(0, 200) : `PageSpeed Insights returned ${status}`);
  }
  if (lighthouse.runtimeError?.code && lighthouse.runtimeError.code !== "NO_ERROR") {
    throw new ProviderError("rejected", `Lighthouse could not load the page (${lighthouse.runtimeError.code})`);
  }
  return parseLighthouse(lighthouse);
}

/* ------------------------------ Chrome UX Report ------------------------------ */

export type CruxPeriod = { periodStart: string; periodEnd: string; lcpP75: number | null; inpP75: number | null; clsP75: number | null };

type CruxDate = { year: number; month: number; day: number };
const isoDate = (d: CruxDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const p75 = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseCruxHistory(record: { metrics?: Record<string, { percentilesTimeseries?: { p75s?: unknown[] } }>; collectionPeriods?: { firstDate: CruxDate; lastDate: CruxDate }[] }): CruxPeriod[] {
  const series = (name: string) => record.metrics?.[name]?.percentilesTimeseries?.p75s ?? [];
  const lcp = series("largest_contentful_paint");
  const inp = series("interaction_to_next_paint");
  const cls = series("cumulative_layout_shift");
  return (record.collectionPeriods ?? [])
    .map((period, index) => ({ periodStart: isoDate(period.firstDate), periodEnd: isoDate(period.lastDate), lcpP75: p75(lcp[index]), inpP75: p75(inp[index]), clsP75: p75(cls[index]) }))
    // A period with no value for any metric did not have enough visitors; it is absent, not zero.
    .filter((p) => p.lcpP75 !== null || p.inpP75 !== null || p.clsP75 !== null);
}

/** Weekly real-user history for an origin. Null means Chrome does not have enough data for it. */
export async function fetchCruxHistory(config: PerformanceConfig, origin: string, formFactor: CruxFormFactor): Promise<CruxPeriod[] | null> {
  const { status, body } = await providerFetch(
    `${config.cruxUrl}?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin, formFactor, metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"] }),
    },
    30_000,
  );
  if (status === 404) return null;
  if (status !== 200 || !body?.record) throw new ProviderError("rejected", `The Chrome UX Report returned ${status}`);
  return parseCruxHistory(body.record as Parameters<typeof parseCruxHistory>[0]);
}

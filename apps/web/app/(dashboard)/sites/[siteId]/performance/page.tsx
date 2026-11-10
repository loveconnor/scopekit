import { PerformanceUrlsForm, RunPerformanceButton } from "@/components/scopekit/health-client";
import { Kpi, KpiRow } from "@/components/scopekit/kpi";
import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { LinkTabs } from "@/components/scopekit/seo";
import { AutoRefresh } from "@/components/scopekit/seo-client";
import { ReportFallback } from "@/components/scopekit/site-header";
import { TrendChart, type TrendRow } from "@/components/scopekit/trend-chart";
import { formatDateTime, formatDay, formatDayLong, formatNumber, type Change } from "@/lib/format";
import { pathOfUrl, PERFORMANCE_DAILY_CAP, performanceConfigured } from "@/lib/health";
import { withParams, type SearchParams } from "@/lib/params";
import { loadSite, requestTime } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { localDateOf } from "@scopekit/analytics";
import { CWV_THRESHOLDS, PERF_DEVICES, rateCwv, type CwvMetric, type CwvRating, type LabScores, type PerfDevice } from "@scopekit/contracts";
import { countPerformanceRunsSince, cruxSeries, getDb, performanceHistory, performanceUrls } from "@scopekit/db";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Performance" };

const INK = { light: "#0f0f0f", dark: "#f5f5f5" };
const SCORES: { key: keyof LabScores; label: string }[] = [
  { key: "performance", label: "Performance" },
  { key: "accessibility", label: "Accessibility" },
  { key: "bestPractices", label: "Best practices" },
  { key: "seo", label: "SEO" },
];
const FIELD: Record<CwvMetric, { label: string; name: string; unit: (v: number) => string; chart: (v: number) => number; series: string }> = {
  lcp: { label: "LCP", name: "Largest Contentful Paint", unit: (v) => `${(v / 1000).toFixed(1)} s`, chart: (v) => Number((v / 1000).toFixed(2)), series: "LCP p75, seconds" },
  inp: { label: "INP", name: "Interaction to Next Paint", unit: (v) => `${formatNumber(Math.round(v))} ms`, chart: (v) => Math.round(v), series: "INP p75, ms" },
  cls: { label: "CLS", name: "Cumulative Layout Shift", unit: (v) => v.toFixed(2), chart: (v) => Number(v.toFixed(3)), series: "CLS p75" },
};
const RATING: Record<CwvRating, { label: string; tone: string }> = {
  good: { label: "Good", tone: "bg-positive" },
  needs_improvement: { label: "Needs improvement", tone: "bg-warning" },
  poor: { label: "Poor", tone: "bg-negative" },
};
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
const seconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? "–" : `${(ms / 1000).toFixed(1)} s`);
const points = (now: number | null | undefined, before: number | null | undefined): Change | null => {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  const delta = now - before;
  return delta === 0 ? { text: "0 points", direction: "flat" } : { text: `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${Math.abs(delta) === 1 ? "point" : "points"}`, direction: delta > 0 ? "up" : "down" };
};

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ siteId }, sp] = await Promise.all([params, searchParams]);
  const site = await loadSite(siteId);
  const db = getDb();
  const pathname = `/sites/${site.id}/performance`;
  const device = PERF_DEVICES.includes(one(sp.device) as PerfDevice) ? (one(sp.device) as PerfDevice) : "mobile";
  const home = `${site.canonicalOrigin}/`;
  const known = await performanceUrls(db, site.id);
  const urls = [...new Set([home, ...known, ...site.settings.performanceUrls])];
  const url = urls.includes(one(sp.url) ?? "") ? one(sp.url)! : home;
  const fieldMetric = (["lcp", "inp", "cls"] as const).find((m) => m === one(sp.field)) ?? "lcp";
  const configured = performanceConfigured();
  const [history, field, usedToday] = await Promise.all([
    performanceHistory(db, site.id, url, device, 60),
    cruxSeries(db, site.id, device === "mobile" ? "PHONE" : "DESKTOP"),
    countPerformanceRunsSince(db, site.id, new Date(requestTime() - 24 * 3_600_000)),
  ]);
  const done = history.filter((r) => r.status === "done");
  const [latest, prior] = done;
  const waiting = history.some((r) => r.status === "queued" || r.status === "running");
  const lastFailed = history[0]?.status === "error" ? history[0] : null;
  const disabledReason = site.isDemo ? "Demo sites are not reachable" : !configured ? "Set GOOGLE_API_KEY to run checks" : usedToday >= PERFORMANCE_DAILY_CAP ? "Today's runs are used up" : undefined;

  const header = (
    <PageHeader
      title="Performance"
      subtitle={
        <>
          {site.name} · <span className="font-mono text-[12px]">{pathOfUrl(url)}</span>
          {site.isDemo ? <span className="ml-2 font-mono text-[11px] text-warning">demo data</span> : null}
        </>
      }
      actions={
        <>
          <LinkTabs label="Device" items={PERF_DEVICES.map((d) => ({ href: withParams(pathname, sp, { device: d === "mobile" ? null : d }), label: d === "mobile" ? "Mobile" : "Desktop", active: d === device }))} />
          {site.isDemo ? null : <RunPerformanceButton siteId={site.id} url={url} disabledReason={disabledReason} />}
        </>
      }
    />
  );

  if (!configured && !history.length && !field.length) {
    return (
      <>
        {header}
        <Panel className="sk-enter max-w-[720px] p-6">
          <h2 className="text-[15px] leading-6 font-medium text-ink">Performance checks are not set up on this server</h2>
          <div className="mt-1 flex max-w-[62ch] flex-col gap-3 text-[13px] leading-5 text-ink-2">
            <p>
              Add <span className="font-mono text-[12px] text-ink">GOOGLE_API_KEY</span> to the environment of the app and the worker, with the PageSpeed Insights API and the Chrome UX Report API enabled for it. Then restart both
            </p>
            <p>Lab runs come from PageSpeed Insights. Field data comes from the Chrome UX Report. Neither is shown as a number until it has been measured</p>
          </div>
          <Provenance source="lighthouse" detail="not configured" className="mt-5" />
        </Panel>
      </>
    );
  }

  const labRows: TrendRow[] = [...done].reverse().map((run) => ({
    label: formatDay(localDateOf(run.checkedAt ?? run.queuedAt, site.timezone)),
    longLabel: formatDateTime(run.checkedAt ?? run.queuedAt, site.timezone),
    performance: run.scores?.performance ?? null,
  }));
  const fieldLatest = field.at(-1) ?? null;
  const fieldValue = (metric: CwvMetric) => (fieldLatest ? (metric === "lcp" ? fieldLatest.lcpP75 : metric === "inp" ? fieldLatest.inpP75 : fieldLatest.clsP75) : null);
  const fieldRows: TrendRow[] = field.map((p) => {
    const value = fieldMetric === "lcp" ? p.lcpP75 : fieldMetric === "inp" ? p.inpP75 : p.clsP75;
    return { label: formatDay(p.periodEnd), longLabel: `28 days to ${formatDayLong(p.periodEnd)}`, value: value === null ? null : FIELD[fieldMetric].chart(value) };
  });
  const cruxState = site.settings.cruxStatus?.[device === "mobile" ? "PHONE" : "DESKTOP"];
  const labDetail = latest ? `${latest.lighthouseVersion ? `v${latest.lighthouseVersion} · ` : ""}${formatDay(localDateOf(latest.checkedAt ?? latest.queuedAt, site.timezone))}` : "no runs";

  return (
    <>
      {header}
      {waiting ? (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-3">
          <AutoRefresh everyMs={5000} />
          <span aria-hidden="true" className="size-1.5 rounded-full bg-positive" />
          <p className="text-[13px] leading-5 text-ink-2">A lab run is in progress. It usually takes under a minute</p>
        </div>
      ) : null}
      {lastFailed ? (
        <p role="alert" className="mb-4 rounded-lg border border-line bg-surface px-5 py-3 text-[13px] leading-5 text-negative">
          The last run failed: {lastFailed.error}. Earlier results below are unchanged
        </p>
      ) : null}
      <div className="sk-enter flex flex-col gap-4">
        {urls.length > 1 ? (
          <LinkTabs label="Page" items={urls.map((u) => ({ href: withParams(pathname, sp, { url: u === home ? null : u }), label: <span className="font-mono text-[12px]">{pathOfUrl(u)}</span>, active: u === url }))} />
        ) : null}

        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
          <h2 className="text-[15px] leading-6 font-medium text-ink">Lab: one test load</h2>
          <p className="text-[13px] leading-5 text-ink-2">Lighthouse, run on Google&apos;s servers with a simulated {device === "mobile" ? "phone" : "desktop"}. It is a repeatable test, not what your visitors experienced</p>
        </div>
        {latest ? (
          <>
            <KpiRow>
              {SCORES.map((s) => (
                <Kpi
                  key={s.key}
                  label={s.label}
                  value={latest.scores?.[s.key] ?? null}
                  unavailable={{ text: "Not returned", reason: "The provider gave no score for this category" }}
                  change={prior ? points(latest.scores?.[s.key], prior.scores?.[s.key]) : undefined}
                  comparedTo={prior ? "vs the run before" : undefined}
                  note={prior ? undefined : "First run, nothing to compare"}
                  source="lighthouse"
                  sourceDetail={labDetail}
                />
              ))}
            </KpiRow>
            <Panel>
              <PanelHeader title="Performance score by run" description="Scores move a few points between identical runs. Two runs in a row are compared before anything counts as a regression" meta={<Provenance source="lighthouse" detail={`${formatNumber(done.length)} ${done.length === 1 ? "run" : "runs"}`} />} />
              {labRows.length > 1 ? (
                <div className="pb-4">
                  <TrendChart rows={labRows} series={[{ key: "performance", label: "Performance score", ...INK, emphasis: true }]} height={280} ariaLabel={`Lighthouse performance score per run for ${pathOfUrl(url)} on ${device}`} />
                </div>
              ) : (
                <PanelEmpty title="One run so far">A trend needs at least two runs. The homepage is checked daily from now on</PanelEmpty>
              )}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line px-5 py-4 sm:grid-cols-5">
                {[
                  ["First Contentful Paint", seconds(latest.metrics?.fcp)],
                  ["Largest Contentful Paint", seconds(latest.metrics?.lcp)],
                  ["Speed Index", seconds(latest.metrics?.speedIndex)],
                  ["Total Blocking Time", latest.metrics?.tbt === null || latest.metrics?.tbt === undefined ? "–" : `${formatNumber(Math.round(latest.metrics.tbt))} ms`],
                  ["Cumulative Layout Shift", latest.metrics?.cls === null || latest.metrics?.cls === undefined ? "–" : latest.metrics.cls.toFixed(2)],
                ].map(([term, value]) => (
                  <div key={term}>
                    <dt className="text-[12px] leading-4 text-ink-3">{term}</dt>
                    <dd className="tnum text-[15px] leading-6 font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel>
              <PanelHeader title="Recommendations from the latest run" description="Only items Lighthouse attached an estimated saving to. The estimates are Lighthouse's own" />
              {latest.opportunities?.length ? (
                <ul className="px-5 pb-3">
                  {latest.opportunities.map((o) => (
                    <li key={o.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
                      <span className="min-w-0 text-[13px] leading-5 text-ink">{o.title}</span>
                      <span className="tnum shrink-0 text-[12px] leading-5 text-ink-2">
                        {[o.savingsMs ? `about ${formatNumber(o.savingsMs)} ms` : null, o.savingsBytes ? `${formatNumber(Math.round(o.savingsBytes / 1024))} KB` : null].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <PanelEmpty title="No recommendation came with an estimated saving" />
              )}
            </Panel>
          </>
        ) : (
          <Panel>
            <PanelEmpty title="No lab run for this page and device yet">{disabledReason ?? "Start one with Run check. It measures mobile and desktop"}</PanelEmpty>
          </Panel>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3">
          <h2 className="text-[15px] leading-6 font-medium text-ink">Field: real visitors</h2>
          <p className="text-[13px] leading-5 text-ink-2">Chrome UX Report for the whole origin, 75th percentile over 28 days, {device === "mobile" ? "phones" : "desktops"} only</p>
        </div>
        {fieldLatest ? (
          <Panel className="border-l-2 border-l-ink-3/40">
            <div className="grid divide-y divide-line border-b border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {(Object.keys(FIELD) as CwvMetric[]).map((metric) => {
                const value = fieldValue(metric);
                const rating = value === null ? null : RATING[rateCwv(metric, value)];
                return (
                  <div key={metric} className="px-5 py-4">
                    <p className="text-[13px] leading-5 text-ink-2">
                      {FIELD[metric].label} <span className="text-ink-3">· {FIELD[metric].name}</span>
                    </p>
                    {value === null || !rating ? (
                      <>
                        <p className="mt-1 text-[16px] leading-8 font-medium text-ink-2">Not enough data</p>
                        <p className="text-[12px] leading-4 text-ink-3">Chrome published no value for this period</p>
                      </>
                    ) : (
                      <>
                        <p className="tnum mt-1 text-[28px] leading-8 font-medium text-ink">{FIELD[metric].unit(value)}</p>
                        <p className="mt-1 flex items-center gap-2 text-[12px] leading-4 text-ink-2">
                          <span aria-hidden="true" className={cn("size-1.5 rounded-full", rating.tone)} />
                          {rating.label}
                          <span className="text-ink-3">
                            · good up to {FIELD[metric].unit(CWV_THRESHOLDS[metric].good)}, poor above {FIELD[metric].unit(CWV_THRESHOLDS[metric].poor)}
                          </span>
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <PanelHeader
              title={`${FIELD[fieldMetric].name}, by collection period`}
              meta={<Provenance source="crux" detail={`28 days to ${formatDay(fieldLatest.periodEnd)}`} />}
              action={<LinkTabs label="Field metric" items={(Object.keys(FIELD) as CwvMetric[]).map((m) => ({ href: withParams(pathname, sp, { field: m === "lcp" ? null : m }), label: FIELD[m].label, active: m === fieldMetric }))} />}
            />
            {fieldRows.filter((r) => r.value !== null).length > 1 ? (
              <div className="pb-4">
                <TrendChart rows={fieldRows} series={[{ key: "value", label: FIELD[fieldMetric].series, ...INK, emphasis: true }]} height={220} ariaLabel={`${FIELD[fieldMetric].name} at the 75th percentile for real visitors of ${site.primaryHostname}, by 28-day period`} />
              </div>
            ) : (
              <PanelEmpty title="Not enough periods for a trend" />
            )}
          </Panel>
        ) : (
          <Panel className="border-l-2 border-l-ink-3/40">
            <PanelEmpty title={cruxState === "no_data" ? "Chrome has no field data for this origin" : cruxState === "error" ? "Field data could not be fetched" : "Field data has not been imported yet"}>
              {cruxState === "no_data"
                ? "Too few Chrome users visited it for Google to publish values. That is common for smaller sites, and it is not a zero"
                : cruxState === "error"
                  ? "The Chrome UX Report did not answer. It is tried again with the next weekly import"
                  : configured
                    ? "It is imported within the hour after the first lab run, then weekly"
                    : "It needs GOOGLE_API_KEY, like lab runs"}
            </PanelEmpty>
            <Provenance source="crux" detail={cruxState === "no_data" ? "not eligible" : "not imported"} className="px-5 pb-4" />
          </Panel>
        )}

        {site.isDemo ? null : (
          <Panel>
            <PanelHeader title="Pages checked weekly" description={`Besides the homepage, which is checked daily. Up to 10 pages, one URL per line. ${formatNumber(usedToday)} of ${PERFORMANCE_DAILY_CAP} runs used in the last 24 hours`} />
            <PanelBody>
              <PerformanceUrlsForm siteId={site.id} urls={site.settings.performanceUrls} origin={site.canonicalOrigin} />
            </PanelBody>
          </Panel>
        )}
      </div>
    </>
  );
}

export default function PerformancePage({ params, searchParams }: PageProps<"/sites/[siteId]/performance">) {
  return (
    <Suspense fallback={<ReportFallback title="Performance" />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelEmpty, PanelHeader, PanelSkeleton } from "@/components/scopekit/panel";
import { formatNumber } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { getDb, listAuditLogs, listJobRuns } from "@scopekit/db";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Activity" };

const JOB_LABELS: Record<string, string> = {
  event_aggregation: "Event aggregation",
  retention_purge: "Retention purge",
  site_purge: "Site purge",
  gsc_sync: "Search Console sync",
  site_crawl: "Site audit crawl",
  page_recheck: "Page recheck",
  alert_evaluation: "Alert check",
};

const stamp = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/** Milliseconds for quick jobs, seconds once a job runs long enough that the digits stop being readable. */
function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  if (ms < 1000) return `${formatNumber(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

function describeJob(job: { jobType: string; cursor: Record<string, unknown> | null; errorCode: string | null }) {
  if (job.errorCode) return job.errorCode;
  const c = job.cursor ?? {};
  if (job.jobType === "event_aggregation") return `${formatNumber(Number(c.days ?? 0))} site-days rebuilt`;
  if (job.jobType === "retention_purge") return `${formatNumber(Number(c.eventsPurged ?? 0))} events and ${formatNumber(Number(c.sitesPurged ?? 0))} sites purged`;
  if (job.jobType === "gsc_sync") {
    const status = String(c.status ?? "");
    const what = `${formatNumber(Number(c.rows ?? 0))} rows from ${formatNumber(Number(c.requests ?? 0))} requests`;
    return status === "rate_limited" ? `Rate limited after ${what}` : status === "partial" ? `${what}, backfill continues` : what;
  }
  if (job.jobType === "site_crawl" || job.jobType === "page_recheck") {
    return `${formatNumber(Number(c.pages ?? 0))} pages, ${formatNumber(Number(c.newIssues ?? 0))} new and ${formatNumber(Number(c.resolvedIssues ?? 0))} resolved issues${c.status === "partial" ? ", partial" : c.status === "cancelled" ? ", stopped" : ""}`;
  }
  if (job.jobType === "alert_evaluation") return `${formatNumber(Number(c.raised ?? 0))} raised, ${formatNumber(Number(c.resolved ?? 0))} resolved`;
  if (job.jobType === "site_purge") return `${formatNumber(Number(c.sitesPurged ?? 0))} sites purged`;
  return "";
}

async function Content() {
  await requireUser();
  const db = getDb();
  const [changes, jobs] = await Promise.all([listAuditLogs(db, { limit: 50 }), listJobRuns(db, 30)]);
  return (
    <div className="sk-enter grid items-start gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader title="Changes" />
        {changes.length ? (
          <ul className="px-5 pb-4">
            {changes.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
                <span className="min-w-0 text-[13px] leading-5 text-ink">{entry.summary}</span>
                <span className="shrink-0 font-mono text-[11px] leading-4 text-ink-3">{stamp.format(entry.at)} UTC</span>
              </li>
            ))}
          </ul>
        ) : (
          <PanelEmpty title="No changes yet" />
        )}
      </Panel>
      <Panel>
        <PanelHeader title="Background jobs" />
        {jobs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-line text-[12px] text-ink-3">
                  <th scope="col" className="h-10 pl-5 text-left font-normal">Job</th>
                  <th scope="col" className="h-10 px-3 text-left font-normal">Result</th>
                  <th scope="col" className="h-10 px-3 text-right font-normal">Took</th>
                  <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal">Started, UTC</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b border-line last:border-0">
                    <th scope="row" className="h-10 pl-5 text-left font-normal whitespace-nowrap text-ink">{JOB_LABELS[job.jobType] ?? job.jobType}</th>
                    <td className={job.status === "error" ? "h-10 px-3 py-2 text-negative" : "h-10 px-3 py-2 text-ink-2"}>
                      {job.status === "error" ? `Failed: ${describeJob(job)}` : describeJob(job)}
                    </td>
                    <td className="tnum h-10 px-3 text-right whitespace-nowrap text-ink-2">{formatDuration(job.durationMs)}</td>
                    <td className="h-10 pr-5 pl-3 text-right font-mono text-[11px] whitespace-nowrap text-ink-3">{stamp.format(job.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelEmpty title="No job runs recorded">Start the worker to aggregate events</PanelEmpty>
        )}
      </Panel>
    </div>
  );
}

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" />
      <Suspense fallback={<PanelSkeleton height={240} />}>
        <Content />
      </Suspense>
    </>
  );
}

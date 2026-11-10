import { AlertActions } from "@/components/scopekit/health-client";
import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelEmpty, PanelHeader, PanelSkeleton } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { LinkTabs } from "@/components/scopekit/seo";
import { formatNumber, formatRelative } from "@/lib/format";
import { ruleTitle } from "@/lib/health";
import { withParams, type SearchParams } from "@/lib/params";
import { loadSites, requestTime } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { ALERT_STATUSES, ALERT_TYPES, type AlertStatus } from "@scopekit/contracts";
import { countAlerts, getDb, listAlerts, type Alert } from "@scopekit/db";
import { ALERT_LABELS } from "@scopekit/health";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Alerts" };

const STATUS_LABELS: Record<AlertStatus, string> = { open: "Open", acknowledged: "Acknowledged", snoozed: "Snoozed", resolved: "Resolved" };

/** The figures behind an alert, in words. */
function evidenceLine(alert: Alert): string {
  const e = alert.evidence;
  switch (alert.type) {
    case "tracking_stopped":
      return `Last event ${e.hoursSilent} hours ago. Events arrived on ${e.activeDaysInWeekBefore} of the 7 days before that`;
    case "search_click_drop":
      return `${formatNumber(Number(e.previousClicks))} clicks, then ${formatNumber(Number(e.clicks))}, over finalized days ${e.from} to ${e.to}`;
    case "new_critical_issue":
      return `${ruleTitle(String(e.rule))} on ${e.pages} ${e.pages === 1 ? "page" : "pages"}${e.example ? `, for example ${String(e.example).replace(/^https?:\/\/[^/]+/, "")}` : ""}`;
    case "lighthouse_regression":
      return `Performance score ${e.before}, then ${e.previousRun} and ${e.latestRun} on consecutive mobile runs${e.lighthouseVersion ? `, Lighthouse ${e.lighthouseVersion}` : ""}`;
    case "cwv_deterioration":
      return `${e.metric} p75 was ${e.previousP75}, now ${e.p75}, for the 28 days to ${e.periodEnd} on phones`;
    case "integration_disconnected":
      return `Search data is kept${e.dataThrough ? ` through ${e.dataThrough}` : ""}. Nothing newer arrives until the Google account is reconnected`;
  }
}

const hrefFor = (alert: Alert) => {
  const base = `/sites/${alert.siteId}`;
  if (alert.type === "tracking_stopped") return `${base}/settings#install`;
  if (alert.type === "search_click_drop") return `${base}/seo/search?range=7d`;
  if (alert.type === "new_critical_issue") return `${base}/audit?rule=${encodeURIComponent(String(alert.evidence.rule))}`;
  if (alert.type === "integration_disconnected") return `${base}/settings/search-console`;
  return `${base}/performance`;
};

async function Content({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const sites = await loadSites();
  const db = getDb();
  const siteIds = sites.map((s) => s.id);
  const status = ALERT_STATUSES.includes(sp.status as AlertStatus) ? (sp.status as AlertStatus) : "open";
  const [alerts, counts] = await Promise.all([listAlerts(db, { siteIds, statuses: [status], limit: 100 }), countAlerts(db, siteIds)]);
  const names = new Map(sites.map((s) => [s.id, s]));
  const now = requestTime();

  return (
    <div className="sk-enter flex flex-col gap-4">
      <Panel>
        <PanelHeader title={`${formatNumber(counts[status])} ${STATUS_LABELS[status].toLowerCase()}`} description="Each alert is raised once for its event, with the figures it was raised from" meta={<Provenance source="scopekit" detail="checked hourly" />} />
        <div className="px-5 pb-3">
          <LinkTabs
            label="Status"
            items={ALERT_STATUSES.map((s) => ({
              href: withParams("/alerts", sp, { status: s === "open" ? null : s }),
              label: (
                <>
                  {STATUS_LABELS[s]}
                  <span className="tnum ml-1.5 font-mono text-[11px] text-ink-3">{formatNumber(counts[s])}</span>
                </>
              ),
              active: s === status,
            }))}
          />
        </div>
        {alerts.length ? (
          <ul>
            {alerts.map((alert) => {
              const site = names.get(alert.siteId);
              return (
                <li key={alert.id} className="grid gap-x-6 gap-y-3 border-t border-line px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-ink-3">
                      <span aria-hidden="true" className={cn("size-1.5 rounded-full", alert.severity === "critical" ? "bg-negative" : "bg-warning")} />
                      <span className="text-ink-2">{alert.severity === "critical" ? "Critical" : "Warning"}</span>
                      <span>· {ALERT_LABELS[alert.type].label}</span>
                      <span>· {site?.name ?? "Deleted site"}</span>
                      {site?.isDemo ? <span className="font-mono text-[11px] text-warning">demo</span> : null}
                    </p>
                    <Link href={hrefFor(alert)} className="mt-1 block rounded-sm text-[15px] leading-6 font-medium text-ink">
                      {alert.headline}
                    </Link>
                    <p className="tnum mt-1 max-w-[80ch] text-[13px] leading-5 text-ink-2">{evidenceLine(alert)}</p>
                    <p className="mt-1 font-mono text-[11px] leading-4 text-ink-3">
                      Raised {formatRelative(alert.createdAt, now).toLowerCase()}
                      {alert.status === "snoozed" && alert.snoozedUntil ? ` · snoozed until ${alert.snoozedUntil}` : ""}
                      {alert.resolvedAt ? ` · resolved ${formatRelative(alert.resolvedAt, now).toLowerCase()}` : ""}
                      {alert.emailedAt ? " · emailed" : ""}
                    </p>
                  </div>
                  <AlertActions alertId={alert.id} status={alert.status} headline={alert.headline} />
                </li>
              );
            })}
          </ul>
        ) : (
          <PanelEmpty title={status === "open" ? "No open alerts" : `No ${STATUS_LABELS[status].toLowerCase()} alerts`}>
            {status === "open" ? "Nothing crossed a rule's threshold. Sites with no data are not treated as having zero traffic" : "Alerts move here when you change their status"}
          </PanelEmpty>
        )}
      </Panel>
      <Panel>
        <PanelHeader title="What raises an alert" description="Switch a rule on or off, and choose email, per site under Site settings" />
        <ul className="px-5 pb-4">
          {ALERT_TYPES.map((type) => (
            <li key={type} className="flex flex-col border-b border-line py-2 last:border-0">
              <span className="text-[13px] leading-5 text-ink">{ALERT_LABELS[type].label}</span>
              <span className="text-[12px] leading-4 text-ink-3">{ALERT_LABELS[type].description}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export default function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  return (
    <>
      <PageHeader title="Alerts" subtitle="Changes that crossed a threshold, across all websites" />
      <Suspense fallback={<PanelSkeleton height={240} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

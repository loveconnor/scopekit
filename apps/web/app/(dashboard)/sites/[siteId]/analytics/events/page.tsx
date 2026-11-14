import { GoalsManager, type GoalRow } from "@/components/scopekit/goals-manager";
import { CodeBlock } from "@/components/scopekit/install";
import { MetricLabel } from "@/components/scopekit/kpi";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { ReportFallback, SiteReportHeader } from "@/components/scopekit/site-header";
import { formatNumber } from "@/lib/format";
import { withParams, type SearchParams } from "@/lib/params";
import { rangeFor } from "@/lib/reports";
import { loadSiteView } from "@/lib/site-view";
import { cn } from "@/lib/utils";
import { dailyTotals, eventPropertySample, eventTable, getDb, goalTotals, listGoals } from "@scopekit/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Events and goals" };

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const { site, params: sp, view, base } = await loadSiteView(params, searchParams);
  const pathname = `${base}/analytics/events`;
  const db = getDb();
  const range = await rangeFor(view, site.timezone);
  const selected = typeof sp.event === "string" ? sp.event : null;
  const [events, goals, totalsByGoal, totals, sample] = await Promise.all([
    eventTable(db, site.id, range.from, range.to),
    listGoals(db, site.id),
    goalTotals(db, site.id, range.from, range.to),
    dailyTotals(db, site.id, range.from, range.to),
    selected ? eventPropertySample(db, site.id, selected) : Promise.resolve([]),
  ]);
  const byGoal = new Map(totalsByGoal.map((t) => [t.goalId, t]));
  const goalRows: GoalRow[] = goals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    enabled: goal.enabled,
    rules: goal.matchingRules,
    completions: byGoal.get(goal.id)?.completions ?? 0,
    convertingSessions: byGoal.get(goal.id)?.convertingSessions ?? 0,
  }));
  const sampleKeys = [...new Set(sample.map((row) => row.key))];

  return (
    <>
      <SiteReportHeader title="Events and goals" range={range} compare={view.compare} allowHourly={false} />
      <div className="sk-enter flex flex-col gap-4">
        <Panel>
          <GoalsManager siteId={site.id} goals={goalRows} sessions={totals.sessions} retentionDays={site.settings.retentionDays} />
        </Panel>

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
          <Panel className="xl:col-span-2">
            <PanelHeader
              title="Event catalog"
              
            />
            {events.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-y border-line text-[12px] text-ink-3">
                      <th scope="col" className="h-10 pl-5 text-left font-normal">Event</th>
                      <th scope="col" className="h-10 px-3 text-right font-normal"><MetricLabel metric="events" label="Count" /></th>
                      <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr
                        key={event.eventName}
                        className={cn("border-b border-line transition-colors duration-150 ease-out last:border-0 hover:bg-raised", selected === event.eventName && "bg-raised")}
                      >
                        <th scope="row" className="h-11 pl-5 text-left font-normal">
                          <Link
                            href={withParams(pathname, sp, { event: selected === event.eventName ? null : event.eventName })}
                            scroll={false}
                            aria-current={selected === event.eventName ? "true" : undefined}
                            className="rounded-sm font-mono text-[12px] text-ink"
                          >
                            {event.eventName}
                          </Link>
                        </th>
                        <td className="tnum h-11 px-3 text-right text-ink">{formatNumber(event.eventCount)}</td>
                        <td className="tnum h-11 pr-5 pl-3 text-right text-ink-2">{formatNumber(event.sessionCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <PanelEmpty title="No events in this range">
                Send them with <span className="font-mono text-[12px]">scopekit.track()</span>
              </PanelEmpty>
            )}
          </Panel>

          <Panel>
            {selected ? (
              <>
                <PanelHeader title="Properties" description={<span className="font-mono text-[12px]">{selected}</span>} />
                {sampleKeys.length ? (
                  <PanelBody className="flex flex-col gap-4">
                    {sampleKeys.map((key) => (
                      <div key={key}>
                        <p className="font-mono text-[12px] leading-4 text-ink-2">{key}</p>
                        <ul className="mt-1">
                          {sample.filter((row) => row.key === key).slice(0, 6).map((row) => (
                            <li key={row.value} className="flex justify-between gap-4 border-b border-line py-1.5 text-[13px] last:border-0">
                              <span className="min-w-0 truncate text-ink">{row.value}</span>
                              <span className="tnum shrink-0 text-ink-2">{formatNumber(row.count)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <p className="text-[12px] leading-4 text-ink-3">
                      From up to 2,000 recent events in the last 30 days. Keys that look like personal data are dropped at collection
                    </p>
                  </PanelBody>
                ) : (
                  <PanelEmpty title="No properties recorded">This event was sent without properties, or they were removed by the privacy filter</PanelEmpty>
                )}
              </>
            ) : (
              <>
                <PanelHeader title="Send an event" description="Flat, non-identifying values only" />
                <PanelBody>
                  <CodeBlock label="JavaScript" code={`window.scopekit?.track("signup_completed", {\n  plan: "free",\n  source: "hero"\n});`} />
                </PanelBody>
              </>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default function EventsPage({ params, searchParams }: PageProps<"/sites/[siteId]/analytics/events">) {
  return (
    <Suspense fallback={<ReportFallback title="Events and goals" kpis={0} />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

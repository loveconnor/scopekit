"use client";

import { formatNumber } from "@/lib/format";
import { sourceLabel } from "@scopekit/analytics";
import { useQuery } from "@tanstack/react-query";
import { BarChart, type ChartConfig } from "honestui/charts";
import { useEffect, useMemo, useState } from "react";
import { BarList } from "./bar-list";
import { MetricLabel } from "./kpi";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "./panel";
import { Provenance } from "./provenance";

type Snapshot = {
  activeSessions: number;
  perMinute: { minute: string; events: number }[];
  topPages: { path: string; pageviews: number }[];
  topSources: { source: string; medium: string; sessions: number }[];
  freshThrough: string | null;
  serverTime: string;
  timezone: string;
};

const POLL_MS = 12_000;
const config = { events: { label: "Events", colors: { light: ["#0f0f0f"], dark: ["#f5f5f5"] } } } satisfies ChartConfig;

/** Approximate live view. Polls every 12 seconds, and only while the tab is visible. */
export function Realtime({ siteId }: { siteId: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const { data, isError, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["realtime", siteId],
    queryFn: async (): Promise<Snapshot> => {
      const response = await fetch(`/api/sites/${siteId}/analytics/realtime`, { cache: "no-store" });
      if (!response.ok) throw new Error("realtime failed");
      return response.json();
    },
    refetchInterval: visible ? POLL_MS : false,
    staleTime: 0,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = useMemo(() => {
    if (!data) return [];
    const byMinute = new Map(data.perMinute.map((point) => [Date.parse(point.minute), point.events]));
    const end = Math.floor(Date.parse(data.serverTime) / 60_000) * 60_000;
    const format = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: data.timezone });
    return Array.from({ length: 30 }, (_, index) => {
      const t = end - (29 - index) * 60_000;
      return { minute: format.format(new Date(t)), events: byMinute.get(t) ?? 0 };
    });
  }, [data]);

  const age = dataUpdatedAt ? Math.max(0, Math.round((now - dataUpdatedAt) / 1000)) : null;
  const freshness = isError ? "update failed, retrying" : age === null ? "loading" : `updated ${age}s ago${visible ? "" : ", paused"}`;
  const total = minutes.reduce((sum, m) => sum + m.events, 0);

  return (
    <div className="flex flex-col gap-4" aria-busy={isFetching}>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="flex flex-col p-5">
          <div className="text-[13px] leading-5 text-ink-2">
            <MetricLabel metric="activeSessions" />
          </div>
          <p className="tnum mt-2 text-[36px] leading-10 font-medium text-ink" aria-live="polite">
            {data ? formatNumber(data.activeSessions) : "–"}
          </p>
          <p className="mt-1 text-[12px] leading-4 text-ink-3">In the last 5 minutes. Approximate, not a count of people</p>
          <Provenance source="scopekit" detail={freshness} className="mt-auto pt-4" />
        </Panel>
        <Panel className="xl:col-span-2">
          <PanelHeader title="Events per minute" description={`${formatNumber(total)} in the last 30 minutes`} meta={<Provenance source="scopekit" detail={freshness} />} />
          <div className="h-[200px] px-2 pb-4">
            {data ? (
              <BarChart data={minutes} config={config} xDataKey="minute" className="h-full w-full" animation={false} barRadius={2} ariaLabel="Accepted events per minute over the last 30 minutes">
                <BarChart.Grid />
                <BarChart.XAxis dataKey="minute" tickFormatter={(value, index) => (index % 5 === 4 ? value : "")} />
                <BarChart.YAxis />
                <BarChart.Tooltip />
                <BarChart.Bar dataKey="events" />
              </BarChart>
            ) : null}
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Pages right now" description="Pageviews in the last 30 minutes" />
          {data?.topPages.length ? (
            <PanelBody>
              <BarList valueLabel="pageviews" items={data.topPages.map((p) => ({ key: p.path, label: <span className="font-mono text-[12px]">{p.path}</span>, value: p.pageviews, title: p.path }))} />
            </PanelBody>
          ) : (
            <PanelEmpty title={data ? "No pageviews in the last 30 minutes" : "Loading"} />
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Sources right now" description="Sessions in the last 30 minutes" />
          {data?.topSources.length ? (
            <PanelBody>
              <BarList valueLabel="sessions" items={data.topSources.map((s) => ({ key: `${s.source}/${s.medium}`, label: sourceLabel(s.source, s.medium), value: s.sessions }))} />
            </PanelBody>
          ) : (
            <PanelEmpty title={data ? "No sessions in the last 30 minutes" : "Loading"} />
          )}
        </Panel>
      </div>
    </div>
  );
}

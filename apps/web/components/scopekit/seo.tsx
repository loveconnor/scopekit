import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { formatDay, formatDayLong, formatDayRange, formatDateTime, formatNumber, formatRelative, type Change } from "@/lib/format";
import { withParams, type SearchParams } from "@/lib/params";
import { requestTime } from "@/lib/reports";
import type { SearchConnection } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { SiteDetail, SiteProperty } from "@scopekit/db";
import { parseProperty, type GscRange } from "@scopekit/seo";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "./page-header";
import { Panel } from "./panel";
import { Provenance } from "./provenance";
import { RangeControl } from "./range-control";
import { AutoRefresh } from "./seo-client";
import type { StatusKey } from "./status";

export const propertyLabel = (property: Pick<SiteProperty, "externalPropertyId">) => parseProperty(property.externalPropertyId)?.label ?? property.externalPropertyId;
export const settingsHref = (siteId: string) => `/sites/${siteId}/settings/search-console`;

/** `through Nov 5`: the newest finalized day, shown next to every search figure. */
export const throughLabel = (date: string) => `through ${formatDay(date)}`;
export const comparedLabel = (range: GscRange) => `vs previous ${range.days === 1 ? "day" : `${range.days} days`}`;

/** One word for where a property stands, from what is stored about it. */
export function propertyStatus(property: SiteProperty, progress: { complete: boolean } | null): StatusKey {
  if (property.connectionStatus === "needs_reauth") return "needs_reauth";
  if (property.syncStatus === "rate_limited") return "rate_limited";
  if (property.syncStatus === "error") return "error";
  if (!property.finalizedThrough || property.syncStatus === "syncing") return "syncing";
  if (progress && !progress.complete) return "backfilling";
  return "connected";
}

/** Quiet link tabs for switching a report's metric, filter or property. The choice lives in the URL. */
export function LinkTabs({ label, items }: { label: string; items: { href: string; label: ReactNode; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          scroll={false}
          aria-current={item.active ? "true" : undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-md px-2.5 text-[13px] leading-5 transition-colors duration-150 ease-out",
            item.active ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function SeoHeader({
  title,
  site,
  conn,
  range,
  compare,
  params,
  pathname,
  actions,
  showRange = true,
}: {
  title: string;
  site: SiteDetail;
  conn: SearchConnection;
  range: GscRange | null;
  compare: boolean;
  params: SearchParams;
  pathname: string;
  actions?: ReactNode;
  showRange?: boolean;
}) {
  const active = conn.active;
  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          <>
            {site.name}
            {range && showRange ? ` · ${formatDayRange(range.from, range.to)}` : ""}
            {active ? (
              <>
                {" · "}
                <span className="font-mono text-[12px]">{propertyLabel(active)}</span>
                {" · Pacific Time days"}
              </>
            ) : null}
            {active?.isDemo ? <span className="ml-2 font-mono text-[11px] text-warning">demo data</span> : null}
          </>
        }
        actions={
          <>
            {range && showRange && active?.finalizedThrough ? (
              <RangeControl preset={range.preset} from={range.from} to={range.to} compare={compare} allowHourly={false} allowToday={false} maxDate={active.finalizedThrough} />
            ) : null}
            {actions}
          </>
        }
      />
      {conn.properties.length > 1 ? (
        <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] leading-4 text-ink-3">Property</span>
          <LinkTabs
            label="Search Console property"
            items={conn.properties.map((p) => ({
              href: withParams(pathname, params, { property: p.id, p: null, query: null, page: null }),
              label: <span className="font-mono text-[12px]">{propertyLabel(p)}</span>,
              active: p.id === active?.id,
            }))}
          />
          <span className="text-[12px] leading-4 text-ink-3">Properties are never added together</span>
        </div>
      ) : null}
    </>
  );
}

function GatePanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Panel className="sk-enter max-w-[720px] p-6">
      <h2 className="text-[15px] leading-6 font-medium text-ink">{title}</h2>
      <div className="mt-1 flex max-w-[62ch] flex-col gap-3 text-[13px] leading-5 text-ink-2">{children}</div>
      {action ? <div className="mt-5">{action}</div> : null}
      <Provenance source="gsc" detail={title === "First sync in progress" ? "syncing" : "not connected"} className="mt-5" />
    </Panel>
  );
}

export function NotConfigured() {
  const redirect = `${env.appUrl}/api/integrations/google/callback`;
  return (
    <GatePanel title="Search Console is not set up on this server">
      <p>Add these to the environment of the app and the worker, then restart both. Analytics keep working without them</p>
      <ul className="flex flex-col font-mono text-[12px] text-ink">
        {["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SCOPEKIT_ENCRYPTION_KEY"].map((name) => (
          <li key={name} className="border-t border-line py-2 first:border-0 first:pt-0">
            {name}
          </li>
        ))}
      </ul>
      <p>
        In the Google Cloud console, create an OAuth client of type Web application, enable the Search Console API, and register this redirect URI
      </p>
      <p className="font-mono text-[12px] break-all text-ink">{redirect}</p>
    </GatePanel>
  );
}

/**
 * What an SEO page shows instead of numbers when there are none to show: the reason, and
 * the next step. Returns null when stored data is available.
 */
export function SearchGate({ site, conn }: { site: SiteDetail; conn: SearchConnection }) {
  if (conn.state === "ready") return null;
  if (conn.state === "not_configured") return <NotConfigured />;
  if (conn.state === "not_connected") {
    return (
      <GatePanel
        title="Search Console is not connected"
        action={
          site.isDemo ? undefined : (
            <Button size="sm" render={<Link href={settingsHref(site.id)} />}>
              Connect Search Console
            </Button>
          )
        }
      >
        <p>
          Link a property to see search clicks, impressions, CTR and position for {site.name}. Access is read-only, and nothing is shown as zero in the meantime
        </p>
      </GatePanel>
    );
  }
  const property = conn.active!;
  const stuck = property.connectionStatus === "needs_reauth" || property.syncStatus === "error" || property.syncStatus === "rate_limited";
  return (
    <GatePanel
      title={stuck ? "The first sync has not finished" : "First sync in progress"}
      action={
        <Button variant="outline" size="sm" render={<Link href={settingsHref(site.id)} />}>
          Open connection
        </Button>
      }
    >
      {stuck ? (
        <p>{property.connectionStatus === "needs_reauth" ? "Google access needs to be renewed before data can be fetched" : (property.lastError ?? "The sync stopped")}</p>
      ) : (
        <>
          <p>Property totals arrive first, usually within a minute of linking. This page refreshes on its own</p>
          <AutoRefresh />
        </>
      )}
    </GatePanel>
  );
}

/** A one-line strip above a report when the connection needs attention or is still filling in. */
export function ConnectionNotice({ site, conn }: { site: SiteDetail; conn: SearchConnection }) {
  const property = conn.active;
  if (!property || property.isDemo) return null;
  const now = requestTime();
  let tone: "warning" | "negative" | "muted" = "muted";
  let text: ReactNode = null;
  let action: ReactNode = null;
  if (property.connectionStatus === "needs_reauth") {
    tone = "warning";
    text = `Google access was revoked or has expired. Data ${property.finalizedThrough ? throughLabel(property.finalizedThrough) : "already synced"} is kept; nothing newer will arrive until you reconnect`;
    action = (
      <Button variant="outline" size="xs" render={<a href={`/api/integrations/google/connect?siteId=${site.id}&integrationId=${property.integrationId}`} />}>
        Reconnect
      </Button>
    );
  } else if (property.syncStatus === "rate_limited") {
    tone = "warning";
    text = `Google's rate limit was reached. The sync retries on its own${property.nextSyncAt ? ` at ${formatDateTime(property.nextSyncAt, site.timezone)}` : ""}`;
  } else if (property.syncStatus === "error") {
    tone = "negative";
    text = `The last sync failed: ${property.lastError ?? "unknown error"}. It will be retried`;
  } else if (conn.progress && !conn.progress.complete) {
    text = `Backfilling query and page history: ${formatNumber(conn.progress.done)} of ${formatNumber(conn.progress.total)} days. Property totals are already complete`;
  } else if (property.lastSyncAt && now - property.lastSyncAt.getTime() > 48 * 3_600_000) {
    tone = "warning";
    text = `Last synced ${formatRelative(property.lastSyncAt, now).toLowerCase()}. Check that the worker is running`;
  }
  if (!text) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-5 py-3">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone === "warning" ? "bg-warning" : tone === "negative" ? "bg-negative" : "bg-ink-3/50")} />
      <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink-2">{text}</p>
      {action}
    </div>
  );
}

/** Change against the previous period in a table cell. Colored only when the direction is good or bad. */
export function ChangeText({ change, upIsGood = true }: { change: Change | null; upIsGood?: boolean }) {
  if (!change) return <span className="text-ink-3">–</span>;
  const good = (change.direction === "up") === upIsGood;
  return <span className={change.direction === "flat" ? "text-ink-3" : good ? "text-positive" : "text-negative"}>{change.text}</span>;
}

export const rangeSentence = (range: GscRange) => `${formatDayLong(range.from)} to ${formatDayLong(range.to)}`;

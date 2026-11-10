import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelBody, PanelEmpty, PanelHeader, PanelSkeleton } from "@/components/scopekit/panel";
import { NotConfigured, propertyLabel, propertyStatus } from "@/components/scopekit/seo";
import { AutoRefresh, PropertyActions, PropertyPicker, type AvailableProperty } from "@/components/scopekit/seo-client";
import { StatusBadge } from "@/components/scopekit/status";
import { Button } from "@/components/ui/button";
import { formatDay, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import type { SearchParams } from "@/lib/params";
import { loadSite, requestTime } from "@/lib/reports";
import { loadSearchConnection, searchConsoleAccess } from "@/lib/seo";
import { requireUser } from "@/lib/session";
import { getDb, listGscSyncRuns, listUserIntegrations, markIntegrationNeedsReauth, type Integration, type SiteDetail, type SiteProperty } from "@scopekit/db";
import { backfillProgress, canReadProperty, GoogleAuthError, listGscSites, parseProperty, PERMISSION_LABELS, propertyMatchesSite, withAccessToken } from "@scopekit/seo";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Search Console" };

const ERRORS: Record<string, string> = {
  denied: "Access was not granted on Google's consent screen, so nothing was connected",
  state: "The sign-in with Google could not be verified. Start the connection again from this page",
  exchange: "Google did not accept the authorization. Start the connection again",
  google: "Google returned an error. Start the connection again",
  no_refresh_token: "Google did not issue long-lived access. Remove ScopeKit under Third-party access in your Google account, then connect again",
  scope: "Read access to Search Console was not granted. Connect again and leave the Search Console permission ticked",
  not_configured: "Search Console is not set up on this server",
};

const RUN_LABELS: Record<string, string> = { done: "Finished", partial: "Paused, continues", rate_limited: "Rate limited", needs_reauth: "Access revoked", error: "Failed", running: "Running" };

/** Properties one Google account can read. This is the only screen that asks Google at request time. */
async function AccountProperties({ site, integration, linked }: { site: SiteDetail; integration: Integration; linked: SiteProperty[] }) {
  const access = searchConsoleAccess();
  const reconnect = (
    <Button variant="outline" size="sm" render={<a href={`/api/integrations/google/connect?siteId=${site.id}&integrationId=${integration.id}`} />}>
      Reconnect
    </Button>
  );
  if (!access) return null;
  if (integration.connectionStatus !== "connected") {
    return <PanelEmpty title="This account needs reconnecting" action={reconnect}>Google access was revoked or has expired. Data already synced is kept</PanelEmpty>;
  }
  let entries;
  try {
    entries = await withAccessToken(getDb(), integration, access, (token) => listGscSites(access.google, token));
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await markIntegrationNeedsReauth(getDb(), integration.id, error.message);
      return <PanelEmpty title="This account needs reconnecting" action={reconnect}>Google access was revoked or has expired. Data already synced is kept</PanelEmpty>;
    }
    return <PanelEmpty title="Google did not answer">The list of properties could not be loaded. Reload the page to try again</PanelEmpty>;
  }
  const properties: AvailableProperty[] = entries
    .flatMap((entry) => {
      const parsed = parseProperty(entry.siteUrl);
      if (!parsed) return [];
      return [
        {
          id: entry.siteUrl,
          label: parsed.label,
          kind: parsed.type === "domain" ? "Domain property" : "URL-prefix property",
          permission: PERMISSION_LABELS[entry.permissionLevel] ?? entry.permissionLevel,
          matches: propertyMatchesSite(parsed, site.hostnames),
          readable: canReadProperty(entry.permissionLevel),
          linked: linked.some((p) => p.externalPropertyId === entry.siteUrl),
        },
      ];
    })
    .sort((a, b) => Number(b.matches) - Number(a.matches) || a.label.localeCompare(b.label));
  if (!properties.length) return <PanelEmpty title="This account has no Search Console properties">Add and verify the site in Search Console first, then reload this page</PanelEmpty>;
  return (
    <PanelBody>
      <PropertyPicker siteId={site.id} integrationId={integration.id} siteHostname={site.primaryHostname} properties={properties} />
    </PanelBody>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ siteId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const site = await loadSite(siteId);
  const db = getDb();
  const conn = await loadSearchConnection(site.id);
  const [integrations, runs] = await Promise.all([listUserIntegrations(db, user.id), listGscSyncRuns(db, site.id, 8)]);
  const now = requestTime();
  const error = typeof sp.gsc_error === "string" ? (ERRORS[sp.gsc_error] ?? ERRORS.google) : null;
  const working = conn.properties.some((p) => !p.isDemo && p.connectionStatus === "connected" && (p.syncStatus === "syncing" || !p.finalizedThrough || !(backfillProgress(p)?.complete ?? true)));
  const connectHref = `/api/integrations/google/connect?siteId=${site.id}`;

  return (
    <>
      <PageHeader
        title="Search Console"
        subtitle={
          <>
            <Link href={`/sites/${site.id}/settings`} className="rounded-sm underline decoration-line underline-offset-4 hover:text-ink">
              Site settings
            </Link>
            {` · ${site.name} · ${site.primaryHostname}`}
          </>
        }
      />
      {working ? <AutoRefresh everyMs={5000} /> : null}
      <div className="sk-enter flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-line bg-surface px-5 py-3 text-[13px] leading-5 text-negative">
            {error}
          </p>
        ) : null}

        {!conn.configured && !conn.properties.length ? <NotConfigured /> : null}

        {conn.properties.length ? (
          <Panel>
            <PanelHeader title="Linked properties" description="Each property is stored and reported on its own. Two properties for one site are never added together" />
            <ul>
              {conn.properties.map((property) => {
                const progress = backfillProgress(property);
                return (
                  <li key={property.id} className="grid gap-x-6 gap-y-3 border-t border-line px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="truncate font-mono text-[13px] leading-5 text-ink">{propertyLabel(property)}</span>
                        <StatusBadge status={propertyStatus(property, progress)} />
                        {property.isDemo ? <span className="font-mono text-[11px] text-warning">demo data</span> : null}
                      </p>
                      <p className="mt-1 text-[12px] leading-4 text-ink-3">
                        {property.externalPropertyType === "domain" ? "Domain property" : "URL-prefix property"} · {property.accountLabel}
                      </p>
                      <dl className="tnum mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] leading-5 sm:grid-cols-4">
                        <div>
                          <dt className="text-[12px] leading-4 text-ink-3">Search data through</dt>
                          <dd className="text-ink">{property.finalizedThrough ? formatDay(property.finalizedThrough) : "Not synced yet"}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] leading-4 text-ink-3">Query and page history</dt>
                          <dd className="text-ink">{progress ? (progress.complete ? `${formatNumber(progress.total)} days` : `Backfilling ${formatNumber(progress.done)} of ${formatNumber(progress.total)} days`) : "Waiting"}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] leading-4 text-ink-3">Last sync</dt>
                          <dd className="text-ink">{property.isDemo ? "Synthetic" : formatRelative(property.lastSyncAt, now)}</dd>
                        </div>
                        <div>
                          <dt className="text-[12px] leading-4 text-ink-3">Next sync</dt>
                          <dd className="text-ink">
                            {property.isDemo || property.connectionStatus !== "connected" || !property.nextSyncAt
                              ? "None"
                              : property.nextSyncAt.getTime() <= now
                                ? "Due now"
                                : formatDateTime(property.nextSyncAt, site.timezone)}
                          </dd>
                        </div>
                      </dl>
                      {property.connectionStatus === "needs_reauth" ? (
                        <p className="mt-3 text-[13px] leading-5 text-ink-2">Google access was revoked or has expired. Stored data is kept, and nothing newer arrives until the account is reconnected</p>
                      ) : property.lastError ? (
                        <p className="mt-3 text-[13px] leading-5 text-ink-2">{property.lastError}. The sync retries on its own</p>
                      ) : null}
                    </div>
                    {property.isDemo ? null : (
                      <div className="flex flex-col items-end gap-2">
                        {property.connectionStatus === "needs_reauth" ? (
                          <Button size="sm" render={<a href={`${connectHref}&integrationId=${property.integrationId}`} />}>
                            Reconnect
                          </Button>
                        ) : null}
                        <PropertyActions siteId={site.id} propertyId={property.id} label={propertyLabel(property)} canSync={property.connectionStatus === "connected" && conn.configured} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        {conn.configured && !site.isDemo
          ? integrations.map((integration) => (
              <Panel key={integration.id}>
                <PanelHeader
                  title={integration.accountLabel}
                  description={`Connected ${formatRelative(integration.createdAt, now).toLowerCase()} with read-only access. Choose the property that holds ${site.primaryHostname}`}
                />
                <Suspense fallback={<div className="px-5 pb-5 text-[13px] leading-5 text-ink-3">Asking Google for this account&apos;s properties</div>}>
                  <AccountProperties site={site} integration={integration} linked={conn.properties} />
                </Suspense>
              </Panel>
            ))
          : null}

        {conn.configured && !site.isDemo ? (
          <Panel className="p-5">
            <h2 className="text-[15px] leading-6 font-medium text-ink">{integrations.length ? "Use another Google account" : "Connect a Google account"}</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] leading-5 text-ink-2">
              ScopeKit asks for read-only access to Search Console and nothing else. Tokens are encrypted before they are stored, and analytics keep working whether or not this is connected
            </p>
            <div className="mt-4">
              <Button size="sm" variant={integrations.length ? "outline" : "default"} render={<a href={connectHref} />}>
                Continue with Google
              </Button>
            </div>
          </Panel>
        ) : null}

        {site.isDemo && !conn.properties.length ? (
          <Panel>
            <PanelEmpty title="Demo sites cannot be connected">Run the demo seed again to add synthetic search data</PanelEmpty>
          </Panel>
        ) : null}

        {runs.length ? (
          <Panel>
            <PanelHeader title="Recent syncs" description="Days are Pacific Time" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-y border-line text-[12px] text-ink-3">
                    <th scope="col" className="h-10 pl-5 text-left font-normal">Started</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal">Result</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal">Days covered</th>
                    <th scope="col" className="h-10 px-3 text-right font-normal">Rows</th>
                    <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal">Google requests</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-line last:border-0">
                      <th scope="row" className="h-10 pl-5 text-left font-normal whitespace-nowrap text-ink-2">{formatDateTime(run.startedAt, site.timezone)}</th>
                      <td className={run.status === "error" || run.status === "needs_reauth" ? "h-10 px-3 text-negative" : "h-10 px-3 text-ink"}>
                        {RUN_LABELS[run.status] ?? run.status}
                        {run.truncated ? <span className="ml-2 text-[12px] text-ink-3">row cap reached</span> : null}
                      </td>
                      <td className="h-10 px-3 whitespace-nowrap text-ink-2">{run.fromDate && run.toDate ? `${formatDay(run.fromDate)} – ${formatDay(run.toDate)}` : "–"}</td>
                      <td className="tnum h-10 px-3 text-right text-ink-2">{formatNumber(run.rowCount)}</td>
                      <td className="tnum h-10 pr-5 pl-3 text-right text-ink-2">{formatNumber(run.requestCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </div>
    </>
  );
}

export default function SearchConsoleSettingsPage({ params, searchParams }: PageProps<"/sites/[siteId]/settings/search-console">) {
  return (
    <div className="mx-auto max-w-[960px]">
      <Suspense
        fallback={
          <>
            <PageHeader title="Search Console" subtitle=" " />
            <PanelSkeleton height={200} />
          </>
        }
      >
        <Content params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

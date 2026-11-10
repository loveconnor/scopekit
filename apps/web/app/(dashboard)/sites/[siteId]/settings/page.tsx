import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelSkeleton } from "@/components/scopekit/panel";
import { propertyLabel, propertyStatus } from "@/components/scopekit/seo";
import { StatusBadge } from "@/components/scopekit/status";
import { Button } from "@/components/ui/button";
import { AlertRuleToggles } from "@/components/scopekit/health-client";
import { loadSearchConnection } from "@/lib/seo";
import { ALERT_TYPES } from "@scopekit/contracts";
import { getDb, listAlertRules } from "@scopekit/db";
import { ALERT_LABELS } from "@scopekit/health";
import Link from "next/link";
import { SiteSettings } from "@/components/scopekit/site-settings";
import { env } from "@/lib/env";
import { loadSite } from "@/lib/reports";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Site settings" };

async function Content({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const site = await loadSite(siteId);
  const conn = await loadSearchConnection(site.id);
  const alertRules = await listAlertRules(getDb(), site.id);
  return (
    <>
      <PageHeader title="Site settings" subtitle={`${site.name} · ${site.primaryHostname}`} />
      <Panel className="mb-4">
        <div className="grid gap-x-10 gap-y-4 p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div>
            <h2 className="text-[15px] leading-6 font-medium text-ink">Search Console</h2>
            <p className="mt-1 text-[13px] leading-5 text-ink-2">Search clicks, impressions, CTR and position from Google</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            {conn.active ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="truncate font-mono text-[13px] text-ink">{propertyLabel(conn.active)}</span>
                <StatusBadge status={propertyStatus(conn.active, conn.progress)} />
              </span>
            ) : (
              <StatusBadge status="not_connected" />
            )}
            <Button variant="outline" size="sm" render={<Link href={`/sites/${site.id}/settings/search-console`} />}>
              {conn.active ? "Manage connection" : "Connect"}
            </Button>
          </div>
        </div>
      </Panel>
      {site.isDemo ? null : (
        <Panel className="mb-4">
          <div className="grid gap-x-10 gap-y-4 p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div>
              <h2 className="text-[15px] leading-6 font-medium text-ink">Alerts</h2>
              <p className="mt-1 text-[13px] leading-5 text-ink-2">
                What may raise an alert for this site. {env.resendKey && env.emailFrom ? "Critical alerts are also emailed" : "Email needs RESEND_API_KEY and SCOPEKIT_EMAIL_FROM"}
              </p>
            </div>
            <AlertRuleToggles
              siteId={site.id}
              emailAvailable={Boolean(env.resendKey && env.emailFrom)}
              rules={ALERT_TYPES.map((type) => {
                const setting = alertRules.find((r) => r.type === type);
                return { type, ...ALERT_LABELS[type], enabled: setting?.enabled ?? true, email: setting?.email ?? false };
              })}
            />
          </div>
        </Panel>
      )}
      <SiteSettings
        key={`${site.id}:${site.settings.version}:${site.privacyMode}:${site.timezone}:${site.name}`}
        collectorUrl={env.collectorUrl}
        site={{
          id: site.id,
          name: site.name,
          timezone: site.timezone,
          privacyMode: site.privacyMode,
          primaryHostname: site.primaryHostname,
          aliases: site.hostnames.filter((h) => h !== site.primaryHostname),
          publicTrackingId: site.publicTrackingId,
          trackingEnabled: site.settings.trackingEnabled,
          geolocationEnabled: site.settings.geolocationEnabled,
          retentionDays: site.settings.retentionDays,
          allowedQueryParams: site.settings.allowedQueryParams,
          excludedPathPatterns: site.settings.excludedPathPatterns,
          isDemo: site.isDemo,
        }}
      />
    </>
  );
}

export default function SiteSettingsPage({ params }: PageProps<"/sites/[siteId]/settings">) {
  return (
    <div className="mx-auto max-w-[960px]">
      <Suspense
        fallback={
          <>
            <PageHeader title="Site settings" subtitle=" " />
            <PanelSkeleton height={200} />
          </>
        }
      >
        <Content params={params} />
      </Suspense>
    </div>
  );
}

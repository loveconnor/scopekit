import { Evidence, SeverityLabel } from "@/components/scopekit/health";
import { CrawlSettingsForm, IssueActions, RuleControls, RunAuditButton } from "@/components/scopekit/health-client";
import { Kpi, KpiRow } from "@/components/scopekit/kpi";
import { PageHeader } from "@/components/scopekit/page-header";
import { Panel, PanelBody, PanelEmpty, PanelHeader } from "@/components/scopekit/panel";
import { Provenance } from "@/components/scopekit/provenance";
import { LinkTabs } from "@/components/scopekit/seo";
import { AutoRefresh } from "@/components/scopekit/seo-client";
import { TableSearch } from "@/components/scopekit/seo-table";
import { ReportFallback } from "@/components/scopekit/site-header";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { effectiveRules, HEALTH_LABELS, loadAuditState, pathOfUrl, SEVERITY_LABELS } from "@/lib/health";
import { withParams, type SearchParams } from "@/lib/params";
import { loadSite, requestTime } from "@/lib/reports";
import { AUDIT_RULES, MIN_AFFECTED_SHARE, SCORE_VERSION, SEVERITY_WEIGHTS } from "@scopekit/audit";
import { ISSUE_STATES, SEVERITIES, type IssueState, type Severity } from "@scopekit/contracts";
import { crawlPageTable, getDb, issueGroups, listIssues } from "@scopekit/db";
import { Download, X } from "honestui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Site audit" };

const STATE_LABELS: Record<IssueState, string> = { open: "Open", ignored: "Ignored", snoozed: "Snoozed", resolved: "Resolved" };
const STOP_REASONS: Record<string, string> = {
  page_limit: "It reached the page limit",
  cancelled: "It was stopped",
  error_budget: "Most requests were failing, so it stopped early",
  time_limit: "It reached the time limit",
};
const PAGE_FILTERS = [
  { value: null, label: "All" },
  { value: "issues", label: "With issues" },
  { value: "errors", label: "Errors" },
  { value: "redirects", label: "Redirects" },
  { value: "noindex", label: "Not indexable" },
] as const;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

async function Content({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ siteId }, sp] = await Promise.all([params, searchParams]);
  const site = await loadSite(siteId);
  const state = await loadAuditState(site.id);
  const now = requestTime();
  const pathname = `/sites/${site.id}/audit`;
  const run = state.latestWithPages;
  const tab = one(sp.tab) === "pages" || one(sp.tab) === "settings" ? (one(sp.tab) as "pages" | "settings") : "issues";
  const header = (
    <PageHeader
      title="Site audit"
      subtitle={
        <>
          <span className="font-mono text-[12px]">{site.primaryHostname}</span>
          {site.isDemo ? <span className="ml-2 rounded-[4px] border border-line px-1 font-mono text-[11px] leading-4 text-ink-3">demo data</span> : null}
        </>
      }
      actions={site.isDemo ? null : <RunAuditButton siteId={site.id} active={!!state.active} />}
    />
  );
  const progress = state.active ? (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface px-5 py-3">
      <AutoRefresh everyMs={3000} />
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-positive" />
      <p className="tnum text-[13px] leading-5 text-ink-2">
        {state.active.status === "queued"
          ? "Waiting for the worker to pick up the crawl"
          : state.active.status === "cancelling"
            ? "Stopping after the pages in flight"
            : state.active.kind === "recheck"
              ? `Rechecking ${pathOfUrl(state.active.targetUrl ?? "")}`
              : `Crawling: ${formatNumber(state.active.pagesCrawled)} of up to ${formatNumber(state.active.maxPages)} pages visited, ${formatNumber(state.active.pagesDiscovered)} found so far`}
      </p>
    </div>
  ) : null;

  if (!run) {
    return (
      <>
        {header}
        {progress}
        <Panel className="sk-enter max-w-[720px] p-6">
          <h2 className="text-[15px] leading-6 font-medium text-ink">{state.latest?.status === "error" ? "The last crawl could not run" : "This site has not been crawled"}</h2>
          <div className="mt-1 flex max-w-[62ch] flex-col gap-3 text-[13px] leading-5 text-ink-2">
            {state.latest?.status === "error" ? <p className="text-negative">{state.latest.errorSummary ?? "It failed without a reason"}</p> : null}
            <p>
              An audit visits up to {formatNumber(site.settings.maxPages)} pages of {site.primaryHostname}, starting from the homepage and its sitemaps, and checks them against {AUDIT_RULES.length} rules for
              broken pages, titles, canonicals, sitemaps and more
            </p>
            <p>It only requests this site&apos;s own hostnames, follows robots.txt, sends no cookies, and makes at most two requests a second</p>
          </div>
          {site.isDemo ? null : (
            <div className="mt-5">
              <RunAuditButton siteId={site.id} active={!!state.active} />
            </div>
          )}
          
        </Panel>
      </>
    );
  }

  const summary = run.summary;
  const openTotal = state.open.critical + state.open.high + state.open.medium + state.open.low;
  const crawlDetail = `crawled ${formatRelative(run.finishedAt ?? run.queuedAt, now).toLowerCase()}`;
  const tabs = (
    <LinkTabs
      label="Audit view"
      items={[
        { href: withParams(pathname, {}, {}), label: "Issues", active: tab === "issues" },
        { href: withParams(pathname, {}, { tab: "pages" }), label: "Pages", active: tab === "pages" },
        { href: withParams(pathname, {}, { tab: "settings" }), label: "Crawl settings", active: tab === "settings" },
      ]}
    />
  );

  return (
    <>
      {header}
      {progress}
      <div className="sk-enter flex flex-col gap-4">
        {state.latest?.status === "error" && state.latest.id !== run.id ? (
          <p role="alert" className="rounded-lg border border-line bg-surface px-5 py-3 text-[13px] leading-5 text-negative">
            The newest crawl could not run: {state.latest.errorSummary ?? "unknown reason"}. Showing the crawl before it
          </p>
        ) : null}
        <KpiRow>
          <Kpi
            label="Health"
            value={state.health === "insufficient_coverage" ? null : HEALTH_LABELS[state.health]}
            unavailable={{ text: "Insufficient coverage", reason: "The last crawl was partial, so it cannot speak for the whole site" }}
            source="scopekit"
            sourceDetail={summary?.score != null ? `score ${summary.score} of 100 · v${summary.scoreVersion}` : "no score for a partial crawl"}
          />
          <Kpi
            label="Pages visited"
            value={run.pagesCrawled}
            note={run.coverageComplete ? `of ${formatNumber(run.pagesDiscovered)} found · complete` : `of ${formatNumber(run.pagesDiscovered)} found · partial`}
            source="scopekit"
            sourceDetail={crawlDetail}
          />
          <Kpi
            label="Open issues"
            value={openTotal}
            note={`${formatNumber(state.open.critical)} critical · ${formatNumber(state.open.high)} high · ${formatNumber(state.open.info)} informational`}
            source="scopekit"
            sourceDetail={crawlDetail}
          />
          <Kpi
            label="Since the crawl before"
            value={state.previous && summary ? `${formatNumber(summary.newIssues)} new` : null}
            unavailable={{ text: "First crawl", reason: "There is no earlier crawl to compare with" }}
            note={summary ? `${formatNumber(summary.resolvedIssues)} resolved` : undefined}
            source="scopekit"
            sourceDetail={run.coverageComplete ? null : "partial crawl"}
          />
        </KpiRow>
        {!run.coverageComplete ? (
          <p className="rounded-lg border border-line bg-surface px-5 py-3 text-[13px] leading-5 text-ink-2">
            Partial crawl. {STOP_REASONS[summary?.stopReason ?? ""] ?? "It did not visit every page it found"}. Pages it did not reach are unknown, not clean, and issues on them stay open
          </p>
        ) : null}

        {tab === "issues" ? <Issues site={{ id: site.id, isDemo: site.isDemo, hostname: site.primaryHostname }} sp={sp} pathname={pathname} runId={run.id} tabs={tabs} timezone={site.timezone} /> : null}

        {tab === "pages" ? <Pages sp={sp} pathname={pathname} runId={run.id} tabs={tabs} /> : null}

        {tab === "settings" ? (
          <>
            <Panel>
              <PanelHeader title="Crawl settings" action={tabs} />
              <PanelBody>
                <CrawlSettingsForm
                  siteId={site.id}
                  settings={{ maxPages: site.settings.maxPages, crawlSchedule: site.settings.crawlSchedule, sitemapUrl: site.settings.sitemapUrl ?? "", crawlExcludedPaths: site.settings.crawlExcludedPaths }}
                />
              </PanelBody>
            </Panel>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel>
                <PanelHeader title="What the crawler does and does not do" />
                <ul className="px-5 pb-4 text-[13px] leading-5 text-ink-2">
                  {[
                    `Requests only ${site.hostnames.join(", ")}. A redirect to anywhere else is recorded and not followed`,
                    "Always follows robots.txt. This cannot be switched off",
                    "Refuses private, loopback and cloud-metadata addresses, on every request and every redirect",
                    "Sends no cookies or sign-in headers, so it sees what an anonymous visitor sees",
                    "At most 2 requests at a time and 2 a second, 10 seconds per page, 2 MB of HTML, 5 redirects",
                    "Reads static HTML only. Content added by JavaScript is not seen",
                  ].map((line) => (
                    <li key={line} className="border-b border-line py-2 last:border-0">{line}</li>
                  ))}
                </ul>
              </Panel>
              <Panel>
                <PanelHeader title="Last crawl" description={`${formatDateTime(run.finishedAt ?? run.queuedAt, site.timezone)} · ${run.trigger === "scheduled" ? "scheduled" : "started by hand"}`} />
                <ul className="px-5 pb-4 text-[13px] leading-5">
                  <li className="flex justify-between gap-4 border-b border-line py-2">
                    <span className="text-ink-2">robots.txt</span>
                    <span className="text-ink">{summary?.robots.found ? "Found and followed" : `Not found (HTTP ${summary?.robots.status ?? "none"}), so nothing is disallowed`}</span>
                  </li>
                  {(summary?.sitemaps ?? []).map((sitemap) => (
                    <li key={sitemap.url} className="flex flex-col border-b border-line py-2 last:border-0">
                      <span className="truncate font-mono text-[12px] text-ink" title={sitemap.url}>{pathOfUrl(sitemap.url)}</span>
                      <span className={sitemap.ok ? "text-[12px] leading-4 text-ink-3" : "text-[12px] leading-4 text-negative"}>{sitemap.ok ? `${formatNumber(sitemap.urls)} URLs on this site` : sitemap.error}</span>
                    </li>
                  ))}
                  {!summary?.sitemaps.length ? <li className="py-2 text-ink-2">No sitemap was found</li> : null}
                </ul>
              </Panel>
            </div>
            <Panel className="p-5">
              <h2 className="text-[15px] leading-6 font-medium text-ink">How the score is calculated</h2>
              <p className="mt-1 max-w-[80ch] text-[13px] leading-5 text-ink-2">
                Only a complete crawl gets a score. It is this product&apos;s own summary of open issues, not a Google rating and not a predictor of rankings
              </p>
              <p className="mt-3 font-mono text-[12px] leading-5 text-ink">score = 100 − Σ weight(severity) × max({MIN_AFFECTED_SHARE}, √(pages affected ÷ pages checked)), per rule with open issues · version {SCORE_VERSION}</p>
              <p className="tnum mt-2 text-[13px] leading-5 text-ink-2">
                Weights: {SEVERITIES.map((s) => `${SEVERITY_LABELS[s].toLowerCase()} ${SEVERITY_WEIGHTS[s]}`).join(", ")}. The floor keeps one broken page on a large site from rounding to nothing. Ignored issues and switched-off rules do not count
              </p>
            </Panel>
          </>
        ) : null}
      </div>
    </>
  );
}

async function Issues({ site, sp, pathname, runId, tabs, timezone }: { site: { id: string; isDemo: boolean; hostname: string }; sp: SearchParams; pathname: string; runId: string; tabs: React.ReactNode; timezone: string }) {
  const db = getDb();
  const issueState = ISSUE_STATES.includes(one(sp.state) as IssueState) ? (one(sp.state) as IssueState) : "open";
  const severity = SEVERITIES.includes(one(sp.severity) as Severity) ? (one(sp.severity) as Severity) : undefined;
  const path = one(sp.path) ?? "";
  const onlyNew = one(sp.new) === "1";
  const filter = { state: issueState, severity, pathPrefix: path, changedInRun: onlyNew ? runId : undefined };
  const rules = await effectiveRules(site.id);
  const selected = rules.find((r) => r.id === one(sp.rule)) ?? null;
  const [groups, detail] = await Promise.all([issueGroups(db, site.id, filter, runId), selected ? listIssues(db, site.id, selected.id, { ...filter, severity: undefined }, 100, 0) : null]);
  const exportQuery = new URLSearchParams({ rule: selected?.id ?? "", state: issueState, format: "csv" });

  return (
    <>
      {selected && detail ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <p className="flex items-center gap-3 text-[12px] leading-4 text-ink-3">
                <SeverityLabel severity={selected.severity} className="text-[12px]" />
                <span className="font-mono text-[11px]">{selected.id} · rule v{selected.version}</span>
              </p>
              <h2 className="mt-1 text-[15px] leading-6 font-medium text-ink">{selected.title}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" render={<a href={`/api/sites/${site.id}/audits/issues?${exportQuery}`} download />}>
                <Download size={14} strokeWidth={1.5} aria-hidden="true" />
                Export CSV
              </Button>
              <Link href={withParams(pathname, sp, { rule: null })} scroll={false} className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-raised hover:text-ink" aria-label="Close rule detail">
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <dl className="grid gap-x-8 gap-y-3 border-y border-line px-5 py-4 text-[13px] leading-5 md:grid-cols-2">
            {[
              ["What it is", selected.why],
              ["Why it matters", selected.impact],
              ["How it is detected", selected.detection],
              ["When it is fine", selected.falsePositives],
              ["What to do", selected.fix],
            ].map(([term, text]) => (
              <div key={term}>
                <dt className="text-[12px] leading-4 text-ink-3">{term}</dt>
                <dd className="text-ink">{text}</dd>
              </div>
            ))}
          </dl>
          {site.isDemo ? null : (
            <div className="border-b border-line px-5 py-3">
              <RuleControls siteId={site.id} ruleId={selected.id} enabled={selected.enabled} severity={selected.severity} defaultSeverity={selected.defaultSeverity} />
            </div>
          )}
          {detail.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[12px] text-ink-3">
                    <th scope="col" className="h-10 pl-5 text-left font-normal">Page</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal">Evidence</th>
                    <th scope="col" className="h-10 px-3 text-left font-normal whitespace-nowrap">First seen</th>
                    <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((issue) => (
                    <tr key={issue.id} className="border-b border-line align-top last:border-0">
                      <th scope="row" className="max-w-[300px] py-3 pl-5 text-left font-normal">
                        <span className="block truncate font-mono text-[12px] leading-5 text-ink" title={issue.url}>{pathOfUrl(issue.url)}</span>
                        {issue.state === "snoozed" && issue.ignoredUntil ? <span className="block text-[12px] leading-4 text-ink-3">Snoozed until {issue.ignoredUntil}</span> : null}
                        {issue.lastSeenRunId !== runId && issue.state === "open" ? <span className="block text-[12px] leading-4 text-ink-3">Not in last crawl</span> : null}
                      </th>
                      <td className="max-w-[360px] px-3 py-3"><Evidence evidence={issue.details.evidence} /></td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink-2">
                        {formatDateTime(issue.firstSeenAt, timezone)}
                        {issue.firstSeenRunId === runId ? <span className="block text-[12px] leading-4 text-ink">New in the last crawl</span> : null}
                      </td>
                      <td className="py-3 pr-5 pl-3 text-right">{site.isDemo ? null : <IssueActions siteId={site.id} issueId={issue.id} state={issue.state} url={issue.url} canRecheck={selected.scope === "page"} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <PanelEmpty title={`No ${STATE_LABELS[issueState].toLowerCase()} issues for this rule`} />
          )}
          {detail.total > detail.rows.length ? <p className="border-t border-line px-5 py-3 text-[12px] leading-4 text-ink-3">Showing 100 of {formatNumber(detail.total)}</p> : null}
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Issues by rule" meta={<Provenance source="scopekit" />} action={tabs} />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pb-2">
          <LinkTabs label="State" items={ISSUE_STATES.map((s) => ({ href: withParams(pathname, sp, { state: s === "open" ? null : s, rule: null }), label: STATE_LABELS[s], active: s === issueState }))} />
          <LinkTabs
            label="Severity"
            items={[
              { href: withParams(pathname, sp, { severity: null }), label: "All", active: !severity },
              ...SEVERITIES.map((s) => ({ href: withParams(pathname, sp, { severity: s }), label: SEVERITY_LABELS[s], active: s === severity })),
              { href: withParams(pathname, sp, { new: onlyNew ? null : "1" }), label: "New in last crawl", active: onlyNew },
            ]}
          />
        </div>
        <form action={pathname} className="flex items-center gap-2 px-5 pb-3">
          {Object.entries(sp).flatMap(([key, value]) => (key === "path" || typeof value !== "string" ? [] : [<input key={key} type="hidden" name={key} value={value} />]))}
          <input name="path" defaultValue={path} aria-label="Path starts with" placeholder="Path starts with, e.g. /blog" className="h-8 w-[280px] max-w-full rounded-md border border-line bg-surface px-3 font-mono text-[12px] text-ink placeholder:text-ink-3" />
          <Button type="submit" variant="outline" size="sm">Filter</Button>
        </form>
        {groups.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-line text-[12px] text-ink-3">
                  <th scope="col" className="h-10 pl-5 text-left font-normal">Severity</th>
                  <th scope="col" className="h-10 px-3 text-left font-normal">Rule</th>
                  <th scope="col" className="h-10 px-3 text-right font-normal">Affected</th>
                  <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal whitespace-nowrap">New in last crawl</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const rule = rules.find((r) => r.id === group.ruleId);
                  return (
                    <tr key={`${group.ruleId}:${group.severity}`} className="border-b border-line align-top transition-colors duration-150 ease-out last:border-0 hover:bg-raised">
                      <td className="py-3 pl-5"><SeverityLabel severity={group.severity} /></td>
                      <th scope="row" className="w-full max-w-0 px-3 py-3 text-left font-normal">
                        <Link href={withParams(pathname, sp, { rule: group.ruleId })} scroll={false} className="block rounded-sm leading-5 font-medium text-ink">
                          {rule?.title ?? group.ruleId}
                        </Link>
                        <span className="block truncate font-mono text-[11px] leading-4 text-ink-3">{group.examples.map(pathOfUrl).join("  ·  ")}</span>
                      </th>
                      <td className="tnum px-3 py-3 text-right text-ink">{formatNumber(group.affected)}</td>
                      <td className="tnum py-3 pr-5 pl-3 text-right text-ink-2">{group.newCount ? formatNumber(group.newCount) : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelEmpty title={issueState === "open" ? "No open issues match" : `Nothing is ${STATE_LABELS[issueState].toLowerCase()}`} />
        )}
      </Panel>
    </>
  );
}

async function Pages({ sp, pathname, runId, tabs }: { sp: SearchParams; pathname: string; runId: string; tabs: React.ReactNode }) {
  const q = one(sp.q) ?? "";
  const only = PAGE_FILTERS.find((f) => f.value === one(sp.only))?.value ?? null;
  const page = Math.max(1, Number(one(sp.p) ?? 1) || 1);
  const limit = 50;
  const table = await crawlPageTable(getDb(), runId, { search: q, only: only ?? undefined, limit, offset: (page - 1) * limit });
  const pages = Math.max(1, Math.ceil(table.total / limit));
  return (
    <Panel>
      <PanelHeader title={`${formatNumber(table.total)} ${table.total === 1 ? "URL" : "URLs"}`} meta={<Provenance source="scopekit" />} action={tabs} />
      <div className="px-5 pb-2">
        <LinkTabs label="Show" items={PAGE_FILTERS.map((f) => ({ href: withParams(pathname, sp, { only: f.value, p: null }), label: f.label, active: f.value === only }))} />
      </div>
      <TableSearch pathname={pathname} params={sp} q={q} label="Search URLs" />
      {table.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-line text-[12px] text-ink-3">
                <th scope="col" className="h-10 pl-5 text-left font-normal">URL</th>
                <th scope="col" className="h-10 px-3 text-left font-normal">Status</th>
                <th scope="col" className="h-10 px-3 text-left font-normal">Title</th>
                <th scope="col" className="h-10 px-3 text-left font-normal">Indexable</th>
                <th scope="col" className="h-10 px-3 text-right font-normal">H1</th>
                <th scope="col" className="h-10 px-3 text-right font-normal">Response</th>
                <th scope="col" className="h-10 px-3 text-right font-normal">Inlinks</th>
                <th scope="col" className="h-10 pr-5 pl-3 text-right font-normal">Issues</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const bad = (row.statusCode ?? 0) >= 400 || !!row.fetchError;
                const why = row.robotsBlocked ? "Blocked by robots.txt" : row.redirectHops ? "Redirects" : row.robotsMeta?.includes("noindex") ? "noindex" : row.canonical && row.canonical !== row.url ? "Canonical elsewhere" : (row.statusCode ?? 0) !== 200 ? "No page" : row.contentType && !row.contentType.includes("html") ? "Not HTML" : "";
                return (
                  <tr key={row.url} className="border-b border-line last:border-0">
                    <th scope="row" className="h-11 max-w-[320px] pl-5 text-left font-normal">
                      <span className="block truncate font-mono text-[12px] text-ink" title={row.url}>{pathOfUrl(row.url)}</span>
                      {row.finalUrl && row.finalUrl !== row.url ? <span className="block truncate font-mono text-[11px] leading-4 text-ink-3" title={row.finalUrl}>to {pathOfUrl(row.finalUrl)}</span> : null}
                    </th>
                    <td className={bad ? "tnum h-11 px-3 whitespace-nowrap text-negative" : "tnum h-11 px-3 whitespace-nowrap text-ink"}>{row.robotsBlocked ? "Not fetched" : (row.statusCode ?? row.fetchError ?? "–")}</td>
                    <td className="h-11 max-w-[260px] px-3"><span className="block truncate text-ink-2" title={row.title ?? undefined}>{row.title ?? "–"}</span></td>
                    <td className="h-11 px-3 whitespace-nowrap text-ink-2">{row.indexable ? "Yes" : <span title={why}>No{why ? `: ${why.toLowerCase()}` : ""}</span>}</td>
                    <td className="tnum h-11 px-3 text-right text-ink-2">{row.h1Count ?? "–"}</td>
                    <td className="tnum h-11 px-3 text-right whitespace-nowrap text-ink-2">{row.responseMs === null ? "–" : `${formatNumber(row.responseMs)} ms`}</td>
                    <td className="tnum h-11 px-3 text-right text-ink-2">{formatNumber(row.internalInlinkCount)}</td>
                    <td className="tnum h-11 pr-5 pl-3 text-right text-ink">{row.issueCount ? formatNumber(row.issueCount) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelEmpty title={q ? `No URL contains “${q}”` : "No URLs match this filter"} />
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          {page > 1 ? <Button variant="outline" size="sm" render={<Link href={withParams(pathname, sp, { p: page > 2 ? String(page - 1) : null })} scroll={false} />}>Previous</Button> : <span />}
          <span className="tnum text-[12px] leading-4 text-ink-3">Page {formatNumber(page)} of {formatNumber(pages)}</span>
          {page < pages ? <Button variant="outline" size="sm" render={<Link href={withParams(pathname, sp, { p: String(page + 1) })} scroll={false} />}>Next</Button> : <span />}
        </div>
      ) : null}
    </Panel>
  );
}

export default function AuditPage({ params, searchParams }: PageProps<"/sites/[siteId]/audit">) {
  return (
    <Suspense fallback={<ReportFallback title="Site audit" />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

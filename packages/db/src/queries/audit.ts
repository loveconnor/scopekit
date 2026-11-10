import type { CrawlStatus, CrawlSummary, IssueState, Severity } from "@scopekit/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "../client";
import { auditIssueObservations, auditIssues, auditRuleSettings, crawlLinks, crawlPages, crawlRuns, siteSettings } from "../schema";
import { chunk, rows } from "../util";

export type CrawlRun = typeof crawlRuns.$inferSelect;
export type AuditIssue = typeof auditIssues.$inferSelect;
export type CrawlPageRow = typeof crawlPages.$inferSelect;

const ACTIVE: CrawlStatus[] = ["queued", "running", "cancelling"];
const UUID = /^[0-9a-f-]{36}$/i;

/* ----------------------------------------------------------------------------
 * Runs
 * ------------------------------------------------------------------------- */

export class CrawlAlreadyActiveError extends Error {}

/** Queues a crawl. A site has at most one crawl queued or running at a time. */
export async function queueCrawl(
  db: Database,
  input: { siteId: string; kind: "full" | "recheck"; targetUrl?: string | null; trigger: "manual" | "scheduled"; maxPages: number },
): Promise<string> {
  return db.transaction(async (tx) => {
    // Serializes queueing per site so two requests cannot both pass the check below.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`crawl:${input.siteId}`}))`);
    const [busy] = await tx
      .select({ id: crawlRuns.id })
      .from(crawlRuns)
      .where(and(eq(crawlRuns.siteId, input.siteId), inArray(crawlRuns.status, ACTIVE)))
      .limit(1);
    if (busy) throw new CrawlAlreadyActiveError();
    const [row] = await tx
      .insert(crawlRuns)
      .values({ siteId: input.siteId, kind: input.kind, targetUrl: input.targetUrl ?? null, trigger: input.trigger, maxPages: input.maxPages })
      .returning({ id: crawlRuns.id });
    return row!.id;
  });
}

/** Queues the scheduled crawl for every site whose last full crawl is older than its schedule. */
export async function scheduleDueCrawls(db: Database): Promise<number> {
  const due = await rows<{ site_id: string; max_pages: number }>(
    db,
    sql`select s.id as site_id, st.max_pages
        from sites s join site_settings st on st.site_id = s.id
        where s.deleted_at is null and not s.is_demo and st.crawl_schedule <> 'off'
          and not exists (select 1 from crawl_runs r where r.site_id = s.id and r.status in ('queued', 'running', 'cancelling'))
          and not exists (
            select 1 from crawl_runs r where r.site_id = s.id and r.kind = 'full'
              and r.queued_at > now() - case when st.crawl_schedule = 'daily' then interval '1 day' else interval '7 days' end
          )
          -- A site is only crawled on a schedule once its owner has run a crawl by hand.
          and exists (select 1 from crawl_runs r where r.site_id = s.id and r.kind = 'full')`,
  );
  let queued = 0;
  for (const site of due) {
    try {
      await queueCrawl(db, { siteId: site.site_id, kind: "full", trigger: "scheduled", maxPages: site.max_pages });
      queued++;
    } catch (error) {
      if (!(error instanceof CrawlAlreadyActiveError)) throw error;
    }
  }
  return queued;
}

/** Marks queued runs as running and returns them. Runs whose worker stopped reporting are closed as failed first. */
export async function claimQueuedCrawls(db: Database, staleMinutes = 10): Promise<string[]> {
  await db.execute(
    sql`update crawl_runs set status = 'error', finished_at = now(), error_summary = 'The worker stopped before the crawl finished'
        where status in ('running', 'cancelling') and coalesce(heartbeat_at, started_at) < now() - make_interval(mins => ${staleMinutes})`,
  );
  const claimed = await rows<{ id: string }>(
    db,
    sql`update crawl_runs r set status = 'running', started_at = now(), heartbeat_at = now()
        where r.id in (select id from crawl_runs where status = 'queued' order by queued_at limit 10 for update skip locked)
        returning r.id`,
  );
  return claimed.map((r) => r.id);
}

export async function getCrawlRun(db: Database, id: string): Promise<CrawlRun | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, id));
  return row ?? null;
}

/** Stores progress and says whether someone asked for the crawl to stop. */
export async function reportCrawlProgress(db: Database, id: string, progress: { discovered: number; crawled: number }): Promise<{ cancel: boolean }> {
  const [row] = await db
    .update(crawlRuns)
    .set({ pagesDiscovered: progress.discovered, pagesCrawled: progress.crawled, heartbeatAt: new Date() })
    .where(eq(crawlRuns.id, id))
    .returning({ status: crawlRuns.status });
  return { cancel: !row || row.status === "cancelling" };
}

export async function requestCrawlCancel(db: Database, siteId: string): Promise<boolean> {
  // A queued run has no worker yet, so it is cancelled on the spot.
  await db
    .update(crawlRuns)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(crawlRuns.siteId, siteId), eq(crawlRuns.status, "queued")));
  const result = await db
    .update(crawlRuns)
    .set({ status: "cancelling" })
    .where(and(eq(crawlRuns.siteId, siteId), eq(crawlRuns.status, "running")))
    .returning({ id: crawlRuns.id });
  return result.length > 0;
}

export async function finishCrawlRun(
  db: Database,
  id: string,
  outcome: { status: CrawlStatus; pagesDiscovered: number; pagesCrawled: number; coverageComplete: boolean; errorSummary?: string | null; summary?: CrawlSummary | null; configHash?: string; crawlerVersion?: number },
): Promise<void> {
  await db
    .update(crawlRuns)
    .set({ ...outcome, errorSummary: outcome.errorSummary?.slice(0, 300) ?? null, finishedAt: new Date(), heartbeatAt: new Date() })
    .where(eq(crawlRuns.id, id));
}

export async function activeCrawl(db: Database, siteId: string): Promise<CrawlRun | null> {
  const [row] = await db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.siteId, siteId), inArray(crawlRuns.status, ACTIVE)))
    .orderBy(desc(crawlRuns.queuedAt))
    .limit(1);
  return row ?? null;
}

/** Finished full crawls, newest first. These are the runs reports are built from. */
export async function listFullCrawls(db: Database, siteId: string, limit = 10): Promise<CrawlRun[]> {
  return db
    .select()
    .from(crawlRuns)
    .where(and(eq(crawlRuns.siteId, siteId), eq(crawlRuns.kind, "full"), inArray(crawlRuns.status, ["done", "partial", "cancelled", "error"])))
    .orderBy(desc(crawlRuns.queuedAt))
    .limit(limit);
}

/** Newest full crawl that produced pages, per site. */
export async function latestCrawlsForSites(db: Database, siteIds: string[]): Promise<Map<string, CrawlRun>> {
  if (!siteIds.length) return new Map();
  const result = await db
    .selectDistinctOn([crawlRuns.siteId])
    .from(crawlRuns)
    .where(and(inArray(crawlRuns.siteId, siteIds), eq(crawlRuns.kind, "full"), inArray(crawlRuns.status, ["done", "partial", "cancelled"])))
    .orderBy(crawlRuns.siteId, desc(crawlRuns.queuedAt));
  return new Map(result.map((r) => [r.siteId, r]));
}

export async function saveCrawlPages(
  db: Database,
  run: { id: string; siteId: string },
  pages: Omit<typeof crawlPages.$inferInsert, "crawlRunId" | "siteId">[],
  links: { sourceUrl: string; targetUrl: string; linkType: "internal" | "canonical" | "redirect" }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const part of chunk(pages, 500)) {
      await tx
        .insert(crawlPages)
        .values(part.map((p) => ({ ...p, crawlRunId: run.id, siteId: run.siteId })))
        .onConflictDoNothing();
    }
    for (const part of chunk(links, 2000)) {
      await tx
        .insert(crawlLinks)
        .values(part.map((l) => ({ ...l, crawlRunId: run.id })))
        .onConflictDoNothing();
    }
  });
}

/** Keeps page and link inventories for the newest crawls only. Runs, issues and observations stay. */
export async function pruneCrawlData(db: Database, siteId: string, keep = 4): Promise<void> {
  await db.execute(
    sql`with old as (
          select id from crawl_runs where site_id = ${siteId} and kind = 'full' order by queued_at desc offset ${keep}
        ), p as (delete from crawl_pages where crawl_run_id in (select id from old))
        delete from crawl_links where crawl_run_id in (select id from old)`,
  );
}

/* ----------------------------------------------------------------------------
 * Rule settings
 * ------------------------------------------------------------------------- */

export type RuleSetting = { ruleId: string; enabled: boolean; severity: Severity | null };

export async function listRuleSettings(db: Database, siteId: string): Promise<RuleSetting[]> {
  return db
    .select({ ruleId: auditRuleSettings.ruleId, enabled: auditRuleSettings.enabled, severity: auditRuleSettings.severity })
    .from(auditRuleSettings)
    .where(eq(auditRuleSettings.siteId, siteId));
}

export async function saveRuleSetting(db: Database, siteId: string, ruleId: string, patch: { enabled?: boolean; severity?: Severity | null }): Promise<void> {
  await db
    .insert(auditRuleSettings)
    .values({ siteId, ruleId, enabled: patch.enabled ?? true, severity: patch.severity ?? null })
    .onConflictDoUpdate({
      target: [auditRuleSettings.siteId, auditRuleSettings.ruleId],
      set: { ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), ...(patch.severity === undefined ? {} : { severity: patch.severity }), updatedAt: new Date() },
    });
  // A changed severity applies to issues that are already open, not just to the next crawl.
  if (patch.severity) await db.update(auditIssues).set({ severity: patch.severity }).where(and(eq(auditIssues.siteId, siteId), eq(auditIssues.ruleId, ruleId)));
}

export async function saveCrawlSettings(
  db: Database,
  siteId: string,
  patch: Partial<Pick<typeof siteSettings.$inferInsert, "maxPages" | "crawlSchedule" | "sitemapUrl" | "crawlExcludedPaths" | "performanceUrls">>,
): Promise<void> {
  await db
    .update(siteSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(siteSettings.siteId, siteId));
}

/* ----------------------------------------------------------------------------
 * Issue lifecycle
 * ------------------------------------------------------------------------- */

export type ResolvedFinding = { ruleId: string; url: string; key?: string; severity: Severity; evidence: Record<string, unknown> };

export const issueIdentity = (url: string, key = "") => createHash("sha256").update(`${url}\u001f${key}`).digest("hex").slice(0, 40);

/**
 * Records what a crawl found and decides what it proves is fixed.
 *
 * Seen again: the issue stays (a resolved one reopens, an ignored one stays ignored) and
 * gets a new observation. Not seen: it is resolved only when this crawl could have seen it:
 * after a complete crawl, or for a rule that needs just the page when that page was fetched.
 * Anything else keeps its state, because not looking is not the same as passing.
 */
export async function applyFindings(
  db: Database,
  input: {
    siteId: string;
    runId: string;
    complete: boolean;
    findings: ResolvedFinding[];
    /** URLs this crawl actually fetched. */
    crawledUrls: string[];
    /** Rules that can be judged from a single page. */
    pageRuleIds: string[];
    /** Rules switched off for the site: their issues are neither raised nor resolved. */
    disabledRuleIds: string[];
    /** URLs that timed out or could not be reached. Their issues are left as they are. */
    unverifiedUrls?: string[];
  },
): Promise<{ newIssues: number; resolvedIssues: number }> {
  const { siteId, runId } = input;
  return db.transaction(async (tx) => {
    const now = new Date();
    // The same identity can be found twice in one crawl (two links to one target); keep the first.
    const unique = new Map<string, ResolvedFinding & { identityHash: string }>();
    for (const finding of input.findings) {
      const identityHash = issueIdentity(finding.url, finding.key);
      const id = `${finding.ruleId}\u001f${identityHash}`;
      if (!unique.has(id)) unique.set(id, { ...finding, identityHash });
    }
    for (const part of chunk([...unique.values()], 400)) {
      const saved = await tx
        .insert(auditIssues)
        .values(
          part.map((f) => ({
            siteId,
            ruleId: f.ruleId,
            url: f.url,
            identityHash: f.identityHash,
            severity: f.severity,
            firstSeenRunId: runId,
            lastSeenRunId: runId,
            firstSeenAt: now,
            lastSeenAt: now,
            details: { evidence: f.evidence },
          })),
        )
        .onConflictDoUpdate({
          target: [auditIssues.siteId, auditIssues.ruleId, auditIssues.identityHash],
          set: {
            lastSeenAt: now,
            lastSeenRunId: runId,
            severity: sql`excluded.severity`,
            details: sql`jsonb_set(excluded.details, '{reason}', coalesce(${auditIssues.details}->'reason', 'null'::jsonb))`,
            // A fixed issue that comes back is new again; a snooze that ran out ends.
            state: sql`case when ${auditIssues.state} = 'resolved' then 'open'
                            when ${auditIssues.state} = 'snoozed' and ${auditIssues.ignoredUntil} < current_date then 'open'
                            else ${auditIssues.state} end`,
            firstSeenRunId: sql`case when ${auditIssues.state} = 'resolved' then excluded.first_seen_run_id else ${auditIssues.firstSeenRunId} end`,
            resolvedAt: sql`case when ${auditIssues.state} = 'resolved' then null else ${auditIssues.resolvedAt} end`,
            resolvedRunId: sql`case when ${auditIssues.state} = 'resolved' then null else ${auditIssues.resolvedRunId} end`,
          },
        })
        .returning({ id: auditIssues.id, identityHash: auditIssues.identityHash, ruleId: auditIssues.ruleId });
      const evidence = new Map(part.map((f) => [`${f.ruleId}\u001f${f.identityHash}`, f.evidence]));
      await tx
        .insert(auditIssueObservations)
        .values(saved.map((s) => ({ issueId: s.id, crawlRunId: runId, evidence: evidence.get(`${s.ruleId}\u001f${s.identityHash}`) ?? {}, observedAt: now })))
        .onConflictDoNothing();
    }

    const notSeen = sql`site_id = ${siteId} and state in ('open', 'snoozed') and (last_seen_run_id is null or last_seen_run_id <> ${runId})`;
    const list = (values: string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
    const unverified = (input.unverifiedUrls ?? []).slice(0, 5000);
    const enabled = sql`${input.disabledRuleIds.length ? sql`and rule_id not in (${list(input.disabledRuleIds)})` : sql``} ${unverified.length ? sql`and url not in (${list(unverified)})` : sql``}`;
    if (input.complete) {
      await tx.execute(sql`update audit_issues set state = 'resolved', resolved_at = ${now.toISOString()}::timestamptz, resolved_run_id = ${runId} where ${notSeen} ${enabled}`);
    } else if (input.crawledUrls.length && input.pageRuleIds.length) {
      for (const part of chunk(input.crawledUrls, 1000)) {
        await tx.execute(
          sql`update audit_issues set state = 'resolved', resolved_at = ${now.toISOString()}::timestamptz, resolved_run_id = ${runId}
              where ${notSeen} ${enabled}
                and rule_id in (${sql.join(input.pageRuleIds.map((id) => sql`${id}`), sql`, `)})
                and url in (${sql.join(part.map((url) => sql`${url}`), sql`, `)})`,
        );
      }
    }
    const [counts] = await rows<{ new_issues: number; resolved_issues: number }>(
      tx,
      sql`select count(*) filter (where first_seen_run_id = ${runId} and state in ('open', 'snoozed'))::int as new_issues,
                 count(*) filter (where resolved_run_id = ${runId})::int as resolved_issues
          from audit_issues where site_id = ${siteId}`,
    );
    return { newIssues: counts?.new_issues ?? 0, resolvedIssues: counts?.resolved_issues ?? 0 };
  });
}

/** Open issue counts by severity, leaving out rules the site switched off. */
export async function openIssueCounts(db: Database, siteId: string): Promise<Record<Severity, number>> {
  const result = await rows<{ severity: Severity; n: number }>(
    db,
    sql`select i.severity, count(*)::int as n from audit_issues i
        where i.site_id = ${siteId} and i.state = 'open'
          and not exists (select 1 from audit_rule_settings s where s.site_id = i.site_id and s.rule_id = i.rule_id and not s.enabled)
        group by i.severity`,
  );
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const r of result) counts[r.severity] = r.n;
  return counts;
}

export async function openIssueCountsForSites(db: Database, siteIds: string[]): Promise<Map<string, Record<Severity, number>>> {
  const out = new Map<string, Record<Severity, number>>();
  if (!siteIds.length) return out;
  const result = await rows<{ site_id: string; severity: Severity; n: number }>(
    db,
    sql`select i.site_id, i.severity, count(*)::int as n from audit_issues i
        where i.site_id in (${sql.join(siteIds.map((id) => sql`${id}`), sql`, `)}) and i.state = 'open'
          and not exists (select 1 from audit_rule_settings s where s.site_id = i.site_id and s.rule_id = i.rule_id and not s.enabled)
        group by i.site_id, i.severity`,
  );
  for (const r of result) {
    const counts = out.get(r.site_id) ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    counts[r.severity] = r.n;
    out.set(r.site_id, counts);
  }
  return out;
}

/** Open issues per rule with how many pages each affects, for the score. */
export async function openIssuesByRule(db: Database, siteId: string): Promise<{ ruleId: string; severity: Severity; affected: number }[]> {
  return rows<{ ruleId: string; severity: Severity; affected: number }>(
    db,
    sql`select i.rule_id as "ruleId", i.severity, count(distinct i.url)::int as affected
        from audit_issues i
        where i.site_id = ${siteId} and i.state = 'open'
          and not exists (select 1 from audit_rule_settings s where s.site_id = i.site_id and s.rule_id = i.rule_id and not s.enabled)
        group by i.rule_id, i.severity`,
  );
}

export type IssueFilter = { state: IssueState; severity?: Severity; pathPrefix?: string; changedInRun?: string };
export type IssueGroup = { ruleId: string; severity: Severity; affected: number; newCount: number; examples: string[]; lastSeenAt: string };

const filterSql = (siteId: string, f: IssueFilter) => {
  const prefix = f.pathPrefix?.trim();
  return sql`i.site_id = ${siteId} and i.state = ${f.state}
    ${f.severity ? sql`and i.severity = ${f.severity}` : sql``}
    ${prefix ? sql`and regexp_replace(i.url, '^https?://[^/]+', '') like ${`${prefix.replace(/[\\%_]/g, "\\$&")}%`}` : sql``}
    ${f.changedInRun ? sql`and i.first_seen_run_id = ${f.changedInRun}` : sql``}`;
};

/** Issues grouped by rule and severity, worst first. */
export async function issueGroups(db: Database, siteId: string, filter: IssueFilter, latestRunId: string | null): Promise<IssueGroup[]> {
  return rows<IssueGroup>(
    db,
    sql`select i.rule_id as "ruleId", i.severity, count(*)::int as affected,
               count(*) filter (where i.first_seen_run_id = ${latestRunId ?? "00000000-0000-0000-0000-000000000000"})::int as "newCount",
               (array_agg(distinct i.url))[1:3] as examples,
               to_char(max(i.last_seen_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastSeenAt"
        from audit_issues i
        where ${filterSql(siteId, filter)}
          and not exists (select 1 from audit_rule_settings s where s.site_id = i.site_id and s.rule_id = i.rule_id and not s.enabled)
        group by i.rule_id, i.severity
        order by array_position(array['critical','high','medium','low','info'], i.severity), count(*) desc, i.rule_id`,
  );
}

export async function listIssues(db: Database, siteId: string, ruleId: string, filter: IssueFilter, limit = 100, offset = 0): Promise<{ rows: AuditIssue[]; total: number }> {
  const result = await rows<{ id: string; total: number }>(
    db,
    sql`select i.id, count(*) over ()::int as total from audit_issues i
        where ${filterSql(siteId, filter)} and i.rule_id = ${ruleId}
        order by i.last_seen_at desc, i.url limit ${limit} offset ${offset}`,
  );
  if (!result.length) return { rows: [], total: 0 };
  const issues = await db.select().from(auditIssues).where(inArray(auditIssues.id, result.map((r) => r.id)));
  const order = new Map(result.map((r, index) => [r.id, index]));
  return { rows: issues.sort((a, b) => order.get(a.id)! - order.get(b.id)!), total: result[0]!.total };
}

/** The highest-severity open issues, one line each, for overview panels. */
export async function topOpenIssues(db: Database, siteId: string, limit = 5): Promise<{ id: string; ruleId: string; url: string; severity: Severity }[]> {
  return rows<{ id: string; ruleId: string; url: string; severity: Severity }>(
    db,
    sql`select i.id, i.rule_id as "ruleId", i.url, i.severity from audit_issues i
        where i.site_id = ${siteId} and i.state = 'open' and i.severity in ('critical', 'high')
          and not exists (select 1 from audit_rule_settings s where s.site_id = i.site_id and s.rule_id = i.rule_id and not s.enabled)
        order by array_position(array['critical','high'], i.severity), i.first_seen_at desc limit ${limit}`,
  );
}

export async function issueObservations(db: Database, issueId: string, limit = 10) {
  return db.select().from(auditIssueObservations).where(eq(auditIssueObservations.issueId, issueId)).orderBy(desc(auditIssueObservations.observedAt)).limit(limit);
}

/** Owner decision on one issue. Reopening clears an ignore or a snooze. */
export async function setIssueState(db: Database, siteId: string, issueId: string, patch: { state: "open" | "ignored" | "snoozed"; until?: string | null; reason?: string }): Promise<AuditIssue | null> {
  if (!UUID.test(issueId)) return null;
  const [row] = await db
    .update(auditIssues)
    .set({
      state: patch.state,
      ignoredUntil: patch.state === "snoozed" ? (patch.until ?? null) : null,
      details: sql`jsonb_set(${auditIssues.details}, '{reason}', ${JSON.stringify(patch.reason ?? null)}::jsonb)`,
    })
    .where(and(eq(auditIssues.id, issueId), eq(auditIssues.siteId, siteId)))
    .returning();
  return row ?? null;
}

/** Snoozes that have run out go back to open. */
export async function expireSnoozes(db: Database): Promise<void> {
  await db.execute(sql`update audit_issues set state = 'open', ignored_until = null where state = 'snoozed' and ignored_until < current_date`);
}

/** Critical issues first seen in a run, for alerting. */
export async function newCriticalIssues(db: Database, runId: string): Promise<{ ruleId: string; urls: string[]; count: number }[]> {
  return rows<{ ruleId: string; urls: string[]; count: number }>(
    db,
    sql`select rule_id as "ruleId", (array_agg(url order by url))[1:3] as urls, count(*)::int as count
        from audit_issues where first_seen_run_id = ${runId} and severity = 'critical' and state = 'open' group by rule_id`,
  );
}

/* ----------------------------------------------------------------------------
 * Page inventory
 * ------------------------------------------------------------------------- */

export async function crawlPageTable(
  db: Database,
  runId: string,
  opts: { search?: string; only?: "errors" | "noindex" | "issues" | "redirects"; limit: number; offset: number },
): Promise<{ rows: CrawlPageRow[]; total: number }> {
  const search = opts.search?.trim();
  const where = sql`crawl_run_id = ${runId}
    ${search ? sql`and url ilike ${`%${search.replace(/[\\%_]/g, "\\$&")}%`}` : sql``}
    ${opts.only === "errors" ? sql`and (status_code >= 400 or fetch_error is not null)` : sql``}
    ${opts.only === "noindex" ? sql`and (robots_meta like '%noindex%' or robots_blocked)` : sql``}
    ${opts.only === "issues" ? sql`and issue_count > 0` : sql``}
    ${opts.only === "redirects" ? sql`and redirect_hops > 0` : sql``}`;
  const [count] = await rows<{ n: number }>(db, sql`select count(*)::int as n from crawl_pages where ${where}`);
  const result = await db
    .select()
    .from(crawlPages)
    .where(where)
    .orderBy(desc(crawlPages.issueCount), crawlPages.depth, crawlPages.url)
    .limit(opts.limit)
    .offset(opts.offset);
  return { rows: result, total: count?.n ?? 0 };
}

export async function crawlPageCount(db: Database, runId: string): Promise<{ pages: number; indexable: number }> {
  const [row] = await rows<{ pages: number; indexable: number }>(db, sql`select count(*)::int as pages, count(*) filter (where indexable)::int as indexable from crawl_pages where crawl_run_id = ${runId}`);
  return row ?? { pages: 0, indexable: 0 };
}

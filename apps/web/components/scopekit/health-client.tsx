"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ALERT_TYPES, ANNOTATION_TYPES, SEVERITIES, type AlertStatus, type AlertType, type AnnotationType, type CrawlSchedule, type IssueState, type Severity } from "@scopekit/contracts";
import { Trash2 } from "honestui/icons";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { send } from "./seo-client";

type Feedback = { busy: boolean; message: string | null; failed: boolean };
const idle: Feedback = { busy: false, message: null, failed: false };

/** One mutation with inline feedback, then a server refresh. */
function useAction() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<Feedback>(idle);
  const run = async (url: string, method: string, body?: unknown, done: string | null = null) => {
    setState({ busy: true, message: null, failed: false });
    const result = await send(url, { method, body });
    setState({ busy: false, message: result.ok ? done : result.message, failed: !result.ok });
    if (result.ok) startTransition(() => router.refresh());
    return result.ok;
  };
  return { state, run };
}

function Note({ state }: { state: Feedback }) {
  if (!state.message) return null;
  return (
    <span role="status" className={state.failed ? "text-[12px] leading-4 text-negative" : "text-[12px] leading-4 text-ink-3"}>
      {state.message}
    </span>
  );
}

const selectClass = "h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink";
const label = "text-[13px] leading-5 text-ink";
const hint = "text-[12px] leading-4 text-ink-3";

/* ------------------------------ Audit ------------------------------ */

export function RunAuditButton({ siteId, active, variant = "default" }: { siteId: string; active: boolean; variant?: "default" | "outline" }) {
  const { state, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {active ? (
        <Button variant="outline" size="sm" disabled={state.busy} onClick={() => run(`/api/sites/${siteId}/audits/run`, "DELETE", undefined, "Stopping")}>
          Stop crawl
        </Button>
      ) : (
        <Button variant={variant} size="sm" disabled={state.busy} onClick={() => run(`/api/sites/${siteId}/audits/run`, "POST")}>
          {state.busy ? "Starting" : "Run audit"}
        </Button>
      )}
      <Note state={state} />
    </span>
  );
}

export function IssueActions({ siteId, issueId, state: issueState, url, canRecheck }: { siteId: string; issueId: string; state: IssueState; url: string; canRecheck: boolean }) {
  const { state, run } = useAction();
  const patch = (body: { state: "open" | "ignored" | "snoozed"; until?: string }) => run(`/api/sites/${siteId}/audits/issues/${issueId}`, "PATCH", body);
  const inThirtyDays = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex flex-wrap justify-end gap-1">
        {issueState === "open" ? (
          <>
            {canRecheck ? (
              <Button variant="outline" size="xs" disabled={state.busy} aria-label={`Recheck ${url}`} onClick={() => run(`/api/sites/${siteId}/audits/recheck-page`, "POST", { url }, "Recheck queued")}>
                Recheck
              </Button>
            ) : null}
            <Button variant="ghost" size="xs" disabled={state.busy} aria-label={`Snooze for 30 days: ${url}`} onClick={() => patch({ state: "snoozed", until: inThirtyDays() })}>
              Snooze 30 d
            </Button>
            <Button variant="ghost" size="xs" disabled={state.busy} aria-label={`Ignore on ${url}`} onClick={() => patch({ state: "ignored" })}>
              Ignore
            </Button>
          </>
        ) : issueState === "resolved" ? null : (
          <Button variant="outline" size="xs" disabled={state.busy} aria-label={`Reopen ${url}`} onClick={() => patch({ state: "open" })}>
            Reopen
          </Button>
        )}
      </span>
      <Note state={state} />
    </span>
  );
}

export function RuleControls({ siteId, ruleId, enabled, severity, defaultSeverity }: { siteId: string; ruleId: string; enabled: boolean; severity: Severity; defaultSeverity: Severity }) {
  const { state, run } = useAction();
  const id = useId();
  const save = (body: { enabled?: boolean; severity?: Severity | null }) => run(`/api/sites/${siteId}/audits/rules`, "PATCH", { ruleId, ...body }, "Saved");
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label htmlFor={`${id}-on`} className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
        <Switch id={`${id}-on`} checked={enabled} onCheckedChange={(checked) => save({ enabled: checked })} />
        Check this rule on this site
      </label>
      <label htmlFor={`${id}-sev`} className="flex items-center gap-2 text-[13px] text-ink-2">
        Severity here
        <select id={`${id}-sev`} className={selectClass} value={severity} disabled={state.busy} onChange={(event) => save({ severity: event.target.value === defaultSeverity ? null : (event.target.value as Severity) })}>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s === defaultSeverity ? `${s} (default)` : s}
            </option>
          ))}
        </select>
      </label>
      <Note state={state} />
    </div>
  );
}

export function CrawlSettingsForm({ siteId, settings }: { siteId: string; settings: { maxPages: number; crawlSchedule: CrawlSchedule; sitemapUrl: string; crawlExcludedPaths: string[] } }) {
  const { state, run } = useAction();
  const ids = { pages: useId(), schedule: useId(), sitemap: useId(), excluded: useId() };
  const [maxPages, setMaxPages] = useState(String(settings.maxPages));
  const [schedule, setSchedule] = useState<CrawlSchedule>(settings.crawlSchedule);
  const [sitemapUrl, setSitemapUrl] = useState(settings.sitemapUrl);
  const [excluded, setExcluded] = useState(settings.crawlExcludedPaths.join("\n"));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void run(`/api/sites/${siteId}/audits/settings`, "PATCH", { maxPages: Number(maxPages), crawlSchedule: schedule, sitemapUrl: sitemapUrl.trim(), crawlExcludedPaths: excluded.split(/[\n,]/).map((p) => p.trim()).filter(Boolean) }, "Saved");
  };
  return (
    <form onSubmit={submit} className="flex max-w-[560px] flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.pages} className={label}>Pages per crawl</label>
          <Input id={ids.pages} type="number" min={10} max={5000} required value={maxPages} onChange={(e) => setMaxPages(e.target.value)} className="tnum" />
          <p className={hint}>A crawl that reaches this limit is labeled partial</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.schedule} className={label}>Schedule</label>
          <select id={ids.schedule} className={`${selectClass} h-9`} value={schedule} onChange={(e) => setSchedule(e.target.value as CrawlSchedule)}>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
            <option value="off">Only when I start it</option>
          </select>
          <p className={hint}>Scheduled crawls begin after the first one you start</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.sitemap} className={label}>Extra sitemap, optional</label>
        <Input id={ids.sitemap} type="url" value={sitemapUrl} onChange={(e) => setSitemapUrl(e.target.value)} placeholder="https://example.com/sitemap.xml" className="font-mono" />
        <p className={hint}>Sitemaps named in robots.txt are read without listing them here</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.excluded} className={label}>Paths to leave out</label>
        <Textarea id={ids.excluded} rows={3} value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder={"/search\n/cart"} className="font-mono" />
        <p className={hint}>One per line. A path covers everything under it</p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={state.busy}>
          {state.busy ? "Saving" : "Save"}
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

/* ------------------------------ Performance ------------------------------ */

export function RunPerformanceButton({ siteId, url, disabledReason }: { siteId: string; url: string; disabledReason?: string }) {
  const { state, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" disabled={state.busy || !!disabledReason} title={disabledReason} onClick={() => run(`/api/sites/${siteId}/performance/run`, "POST", { url }, "Queued. Results appear here in about a minute")}>
        {state.busy ? "Queueing" : "Run check"}
      </Button>
      <Note state={state} />
    </span>
  );
}

export function PerformanceUrlsForm({ siteId, urls, origin }: { siteId: string; urls: string[]; origin: string }) {
  const { state, run } = useAction();
  const id = useId();
  const [value, setValue] = useState(urls.join("\n"));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void run(`/api/sites/${siteId}/performance/settings`, "PATCH", { performanceUrls: value.split(/\n/).map((u) => u.trim()).filter(Boolean) }, "Saved");
  };
  return (
    <form onSubmit={submit} className="flex max-w-[560px] flex-col gap-3">
      <label htmlFor={id} className="sr-only">Pages to check weekly</label>
      <Textarea id={id} rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`${origin}/pricing`} className="font-mono" />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={state.busy}>
          Save
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

/* ------------------------------ Alerts ------------------------------ */

const ALERT_ACTIONS: Record<AlertStatus, { status: AlertStatus; label: string; snooze?: boolean }[]> = {
  open: [{ status: "acknowledged", label: "Acknowledge" }, { status: "snoozed", label: "Snooze 7 d", snooze: true }, { status: "resolved", label: "Resolve" }],
  acknowledged: [{ status: "resolved", label: "Resolve" }, { status: "snoozed", label: "Snooze 7 d", snooze: true }],
  snoozed: [{ status: "open", label: "Wake" }, { status: "resolved", label: "Resolve" }],
  resolved: [{ status: "open", label: "Reopen" }],
};

export function AlertActions({ alertId, status, headline }: { alertId: string; status: AlertStatus; headline: string }) {
  const { state, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex flex-wrap justify-end gap-1">
        {ALERT_ACTIONS[status].map((action, index) => (
          <Button
            key={action.label}
            variant={index === 0 ? "outline" : "ghost"}
            size="xs"
            disabled={state.busy}
            aria-label={`${action.label}: ${headline}`}
            onClick={() => run(`/api/alerts/${alertId}`, "PATCH", { status: action.status, ...(action.snooze ? { until: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) } : {}) })}
          >
            {action.label}
          </Button>
        ))}
      </span>
      <Note state={state} />
    </span>
  );
}

export function AlertRuleToggles({ siteId, rules, emailAvailable }: { siteId: string; rules: { type: AlertType; label: string; description: string; enabled: boolean; email: boolean }[]; emailAvailable: boolean }) {
  const { state, run } = useAction();
  const ordered = ALERT_TYPES.map((type) => rules.find((r) => r.type === type)!).filter(Boolean);
  return (
    <div className="flex flex-col">
      {ordered.map((rule) => (
        <div key={rule.type} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-3 first:border-0 first:pt-0">
          <div className="min-w-0 flex-1 basis-[280px]">
            <p className="text-[13px] leading-5 text-ink">{rule.label}</p>
            <p className={hint}>{rule.description}</p>
          </div>
          <div className="flex items-center gap-5">
            {emailAvailable ? (
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
                <Switch aria-label={`Email for ${rule.label}`} checked={rule.email} disabled={!rule.enabled} onCheckedChange={(email) => run(`/api/sites/${siteId}/alert-rules`, "PATCH", { type: rule.type, email })} />
                Email
              </label>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
              <Switch aria-label={`${rule.label} alerts`} checked={rule.enabled} onCheckedChange={(enabled) => run(`/api/sites/${siteId}/alert-rules`, "PATCH", { type: rule.type, enabled })} />
              On
            </label>
          </div>
        </div>
      ))}
      <Note state={state} />
    </div>
  );
}

/* ------------------------------ Annotations ------------------------------ */

const TYPE_LABELS: Record<AnnotationType, string> = { deployment: "Deployment", content: "Content", migration: "Migration", custom: "Other" };

export function AnnotationForm({ siteId, today }: { siteId: string; today: string }) {
  const { state, run } = useAction();
  const ids = { date: useId(), type: useId(), title: useId(), sha: useId() };
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [type, setType] = useState<AnnotationType>("deployment");
  const [title, setTitle] = useState("");
  const [commitSha, setCommitSha] = useState("");
  if (!open) {
    return (
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        Add annotation
      </Button>
    );
  }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await run(`/api/sites/${siteId}/annotations`, "POST", { date, type, title, commitSha: commitSha.trim() })) {
      setTitle("");
      setCommitSha("");
      setOpen(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3 border-t border-line px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[150px_150px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.date} className={label}>Date</label>
          <Input id={ids.date} size="sm" type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.type} className={label}>Kind</label>
          <select id={ids.type} className={selectClass} value={type} onChange={(e) => setType(e.target.value as AnnotationType)}>
            {ANNOTATION_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.title} className={label}>What changed</label>
          <Input id={ids.title} size="sm" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New pricing page" />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.sha} className={label}>Commit, optional</label>
          <Input id={ids.sha} size="sm" value={commitSha} onChange={(e) => setCommitSha(e.target.value)} placeholder="a1b2c3d" className="w-[150px] font-mono" />
        </div>
        <Button type="submit" size="sm" disabled={state.busy}>
          {state.busy ? "Saving" : "Save annotation"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function DeleteAnnotationButton({ siteId, id, title }: { siteId: string; id: string; title: string }) {
  const { state, run } = useAction();
  return (
    <Button variant="ghost" size="icon-sm" disabled={state.busy} aria-label={`Delete annotation: ${title}`} onClick={() => run(`/api/sites/${siteId}/annotations/${id}`, "DELETE")}>
      <Trash2 size={14} strokeWidth={1.5} />
    </Button>
  );
}

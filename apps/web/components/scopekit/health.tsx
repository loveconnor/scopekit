import { formatDay } from "@/lib/format";
import { SEVERITY_LABELS } from "@/lib/health";
import { cn } from "@/lib/utils";
import type { AnnotationType, Severity } from "@scopekit/contracts";
import type { Annotation, SiteDetail } from "@scopekit/db";
import { localDateOf } from "@scopekit/analytics";
import { requestTime } from "@/lib/reports";
import { AnnotationForm, DeleteAnnotationButton } from "./health-client";
import { Panel, PanelHeader } from "./panel";

const TONES: Record<Severity, string> = { critical: "bg-negative", high: "bg-negative/70", medium: "bg-warning", low: "bg-ink-3/60", info: "bg-ink-3/30" };

/** Severity as a word with a small dot. The word carries the meaning; the dot only helps scanning. */
export function SeverityLabel({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[13px] leading-5 whitespace-nowrap text-ink", className)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONES[severity])} />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

/** Evidence stored with an issue, as plain key and value lines. Values come from crawled pages, so they are only ever rendered as text. */
export function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(([, value]) => value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length));
  if (!entries.length) return <span className="text-[12px] text-ink-3">No extra detail</span>;
  const text = (value: unknown): string => (Array.isArray(value) ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value));
  return (
    <dl className="flex flex-col gap-0.5">
      {entries.slice(0, 5).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-[12px] leading-4">
          <dt className="shrink-0 text-ink-3">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
          <dd className="min-w-0 font-mono text-[11px] break-all text-ink-2">{text(value).slice(0, 300)}</dd>
        </div>
      ))}
    </dl>
  );
}

const ANNOTATION_LABELS: Record<AnnotationType, string> = { deployment: "Deployment", content: "Content", migration: "Migration", custom: "Other" };

/**
 * Dated notes about changes the owner made. They sit next to the data so a shift can be
 * read against what happened that day; they do not claim to have caused it.
 */
export function AnnotationsPanel({ site, annotations, description }: { site: SiteDetail; annotations: Annotation[]; description?: string }) {
  const today = localDateOf(new Date(requestTime()), site.timezone);
  return (
    <Panel>
      <PanelHeader title="Annotations" description={description ?? "Deployments and other changes, by date. A note marks when something changed, not why a number moved"} />
      {annotations.length ? (
        <ul className="px-5 pb-2">
          {annotations.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-5 text-ink">{a.title}</span>
                <span className="block font-mono text-[11px] leading-4 text-ink-3">
                  {formatDay(a.date)} · {ANNOTATION_LABELS[a.type]}
                  {a.commitSha ? ` · ${a.commitSha.slice(0, 7)}` : ""}
                </span>
              </span>
              <DeleteAnnotationButton siteId={site.id} id={a.id} title={a.title} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-3 text-[13px] leading-5 text-ink-2">Nothing noted yet</p>
      )}
      <div className="flex px-5 pb-4 [&:has(form)]:px-0 [&:has(form)]:pb-0">
        <AnnotationForm siteId={site.id} today={today} />
      </div>
    </Panel>
  );
}

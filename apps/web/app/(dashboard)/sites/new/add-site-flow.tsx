"use client";

import { CodeBlock, VerifyTracking } from "@/components/scopekit/install";
import { buildSnippet } from "@/lib/snippet";
import { Panel } from "@/components/scopekit/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";

type Created = { id: string; publicTrackingId: string; origin: string };
type FieldErrors = Partial<Record<"name" | "url" | "timezone", string>>;

const STEPS = ["Website", "Install tracking", "Search Console"];

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] leading-5 text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12px] leading-4 text-negative">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] leading-4 text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function AddSiteFlow({ collectorUrl }: { collectorUrl: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [site, setSite] = useState<Created | null>(null);
  const [form, setForm] = useState<{ name: string; url: string; timezone: string | null }>({ name: "", url: "", timezone: null });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);
  // The browser's timezone is the default; it is only known on the client.
  const browserTimezone = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    () => "UTC",
  );
  const timezone = form.timezone ?? browserTimezone;

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFailure(null);
    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, timezone }),
      });
      const body = await response.json();
      if (!response.ok) {
        const fieldErrors: FieldErrors = {};
        for (const detail of (body.details ?? []) as { path: string; message: string }[]) {
          if (detail.path === "name" || detail.path === "url" || detail.path === "timezone") fieldErrors[detail.path] = detail.message;
        }
        setErrors(fieldErrors);
        if (Object.keys(fieldErrors).length === 0) setFailure(body.message ?? "The website could not be added");
        return;
      }
      setSite(body);
      setStep(1);
      router.refresh();
    } catch {
      setFailure("The website could not be added. Check your connection and try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <ol className="mb-6 flex items-center gap-2 text-[13px]">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2" aria-current={index === step ? "step" : undefined}>
            <span
              className={cn(
                "tnum flex size-6 items-center justify-center rounded-full border font-mono text-[12px]",
                index === step ? "border-strong bg-strong text-on-strong" : index < step ? "border-line bg-raised text-ink" : "border-line text-ink-3",
              )}
            >
              {index + 1}
            </span>
            <span className={index === step ? "text-ink" : "text-ink-3"}>{label}</span>
            {index < STEPS.length - 1 ? <span aria-hidden="true" className="mx-1 h-px w-6 bg-line" /> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Panel className="p-6">
          <form onSubmit={create} className="flex flex-col gap-5" noValidate>
            <Field id="name" label="Name" error={errors.name}>
              <Input
                id="name"
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Personal site"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "name-error" : undefined}
              />
            </Field>
            <Field id="url" label="URL" hint="The canonical address. The www and bare forms are treated as the same site" error={errors.url}>
              <Input
                id="url"
                required
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="example.com"
                className="font-mono"
                aria-invalid={Boolean(errors.url)}
                aria-describedby={errors.url ? "url-error" : undefined}
              />
            </Field>
            <Field id="timezone" label="Timezone" hint="Days in reports start and end in this timezone" error={errors.timezone}>
              <Input
                id="timezone"
                required
                list="timezones"
                value={timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                aria-invalid={Boolean(errors.timezone)}
                aria-describedby={errors.timezone ? "timezone-error" : undefined}
              />
              <datalist id="timezones">
                {timezones.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </Field>
            <p className="text-[12px] leading-4 text-ink-3">
              Starts in privacy-first mode: no cookies, visitors estimated per day. You can change this in site settings
            </p>
            {failure ? (
              <p role="alert" className="text-[13px] leading-5 text-negative">
                {failure}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={submitting || !form.name.trim() || !form.url.trim()}>
                {submitting ? "Adding" : "Add website"}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {step === 1 && site ? (
        <Panel className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-[15px] leading-6 font-medium text-ink">Add this to every page</h2>
            <p className="text-[13px] leading-5 text-ink-2">
              Put it in the document head or root layout of <span className="font-mono text-[12px]">{site.origin}</span>, then open the site
            </p>
          </div>
          {collectorUrl ? (
            <CodeBlock
              label="HTML"
              code={buildSnippet({ collectorUrl, publicId: site.publicTrackingId, consent: false, queryParams: [] })}
            />
          ) : (
            <p role="alert" className="text-[13px] leading-5 text-negative">
              NEXT_PUBLIC_COLLECTOR_URL is not set, so the snippet cannot be generated
            </p>
          )}
          <VerifyTracking siteId={site.id} />
          <div className="flex items-center gap-2 border-t border-line pt-5">
            <Button onClick={() => setStep(2)}>Continue</Button>
            <span className="text-[12px] leading-4 text-ink-3">You can verify later from site settings</span>
          </div>
        </Panel>
      ) : null}

      {step === 2 && site ? (
        <Panel className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-[15px] leading-6 font-medium text-ink">Connect Search Console, if you want search data</h2>
            <p className="max-w-[60ch] text-[13px] leading-5 text-ink-2">
              Optional. It adds search clicks, impressions, CTR and position from Google with read-only access. Skip it and search metrics
              show as not connected instead of zero
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button render={<Link href={`/sites/${site.id}/settings/search-console`} />}>Connect Search Console</Button>
            <Button variant="outline" render={<Link href={`/sites/${site.id}/overview`} />}>
              Skip for now
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

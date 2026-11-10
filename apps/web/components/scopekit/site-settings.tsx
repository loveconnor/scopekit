"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PrivacyMode, UpdateSiteInput } from "@scopekit/contracts";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { buildSnippet } from "@/lib/snippet";
import { CodeBlock, VerifyTracking } from "./install";
import { Panel } from "./panel";

export type SettingsSite = {
  id: string;
  name: string;
  timezone: string;
  privacyMode: PrivacyMode;
  primaryHostname: string;
  aliases: string[];
  publicTrackingId: string | null;
  trackingEnabled: boolean;
  geolocationEnabled: boolean;
  retentionDays: number;
  allowedQueryParams: string[];
  excludedPathPatterns: string[];
  isDemo: boolean;
};

function useSave(siteId: string) {
  const router = useRouter();
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>({ status: "idle" });
  const save = async (patch: UpdateSiteInput) => {
    setState({ status: "saving" });
    const response = await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setState({ status: "error", message: body?.message ?? "Could not save" });
      return false;
    }
    setState({ status: "saved" });
    router.refresh();
    return true;
  };
  return { state, save };
}

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Panel className="scroll-mt-20">
      <div id={id} className="grid gap-x-10 gap-y-4 p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div>
          <h2 className="text-[15px] leading-6 font-medium text-ink">{title}</h2>
          {description ? <p className="mt-1 text-[13px] leading-5 text-ink-2">{description}</p> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    </Panel>
  );
}

function SaveRow({ state, disabled }: { state: ReturnType<typeof useSave>["state"]; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" variant="outline" size="sm" disabled={disabled || state.status === "saving"}>
        {state.status === "saving" ? "Saving" : "Save"}
      </Button>
      <span role="status" className={state.status === "error" ? "text-[13px] text-negative" : "text-[13px] text-ink-2"}>
        {state.status === "saved" ? "Saved" : state.status === "error" ? state.message : ""}
      </span>
    </div>
  );
}

const label = "text-[13px] leading-5 text-ink";
const hint = "text-[12px] leading-4 text-ink-3";
const lines = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);

const PRIVACY: { value: PrivacyMode; title: string; body: string }[] = [
  {
    value: "default",
    title: "Privacy-first",
    body: "No cookies. Visitors are estimated per site per day from a salted hash that rotates daily; the IP address is never stored. This can still be personal data in some jurisdictions",
  },
  {
    value: "strict",
    title: "Strict",
    body: "No visitor estimate at all. Pageviews and sessions only; visitor metrics show as not available",
  },
  {
    value: "consent",
    title: "Consent-based",
    body: "A first-party cookie identifies returning visitors. Nothing is sent or stored until your site calls scopekit.enable() after consent",
  },
];

export function SiteSettings({ site, collectorUrl }: { site: SettingsSite; collectorUrl: string }) {
  const router = useRouter();
  const general = useSave(site.id);
  const domains = useSave(site.id);
  const tracking = useSave(site.id);
  const urls = useSave(site.id);
  const ids = { name: useId(), tz: useId(), alias: useId(), retention: useId(), query: useId(), excluded: useId(), confirm: useId() };

  const [name, setName] = useState(site.name);
  const [timezone, setTimezone] = useState(site.timezone);
  const [aliases, setAliases] = useState(site.aliases.join("\n"));
  const [trackingEnabled, setTrackingEnabled] = useState(site.trackingEnabled);
  const [geolocationEnabled, setGeolocationEnabled] = useState(site.geolocationEnabled);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(site.privacyMode);
  const [retentionDays, setRetentionDays] = useState(String(site.retentionDays));
  const [queryParams, setQueryParams] = useState(site.allowedQueryParams.join(", "));
  const [excluded, setExcluded] = useState(site.excludedPathPatterns.join("\n"));
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);

  const snippet = site.publicTrackingId
    ? buildSnippet({ collectorUrl, publicId: site.publicTrackingId, consent: site.privacyMode === "consent", queryParams: site.allowedQueryParams })
    : null;
  const nextSnippet = site.publicTrackingId
    ? `import { ScopeKit } from "@scopekit/sdk/next";\n\n// in the root layout\n<ScopeKit\n  siteId="${site.publicTrackingId}"\n  collectorUrl="${collectorUrl}"${site.privacyMode === "consent" ? "\n  consentMode" : ""}\n/>`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Section title="General" description="Reports use this timezone for day boundaries">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void general.save({ name, timezone });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className={label}>Name</label>
            <Input id={ids.name} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="max-w-[360px]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.tz} className={label}>Timezone</label>
            <Input id={ids.tz} required list={`${ids.tz}-list`} value={timezone} onChange={(e) => setTimezone(e.target.value)} className="max-w-[360px]" />
            <datalist id={`${ids.tz}-list`}>{timezones.map((tz) => <option key={tz} value={tz} />)}</datalist>
            <p className={hint}>Changing it rebuilds daily figures for the days that still have raw events</p>
          </div>
          <SaveRow state={general.state} />
        </form>
      </Section>

      <Section id="install" title="Install" description="One deferred script, about 2 KB gzipped. It never blocks rendering">
        {site.isDemo ? (
          <p className="text-[13px] leading-5 text-ink-2">This is a synthetic demo site. The collector does not accept events for it</p>
        ) : snippet && collectorUrl ? (
          <>
            <CodeBlock label="HTML, in the document head" code={snippet} />
            <CodeBlock label="Next.js App Router" code={nextSnippet!} />
            <VerifyTracking siteId={site.id} />
          </>
        ) : (
          <p role="alert" className="text-[13px] leading-5 text-negative">NEXT_PUBLIC_COLLECTOR_URL is not set, so the snippet cannot be generated</p>
        )}
      </Section>

      <Section title="Domains" description="Events are accepted only from pages on these hostnames. This limits accidental misuse; it does not authenticate browsers">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void domains.save({ aliases: lines(aliases).map((h) => h.toLowerCase()) });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <span className={label}>Primary</span>
            <span className="font-mono text-[13px] leading-5 text-ink-2">{site.primaryHostname}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.alias} className={label}>Aliases</label>
            <Textarea id={ids.alias} rows={3} value={aliases} onChange={(e) => setAliases(e.target.value)} className="max-w-[360px] font-mono text-[13px]" spellCheck={false} />
            <p className={hint}>One hostname per line, including a port for local testing such as localhost:3000</p>
          </div>
          <SaveRow state={domains.state} />
        </form>
      </Section>

      <Section title="Tracking and privacy" description="Sites remain responsible for their own notices and consent where the law requires them">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void tracking.save({ trackingEnabled, geolocationEnabled, privacyMode, retentionDays: Number(retentionDays) });
          }}
        >
          <label className="flex items-start gap-3">
            <Switch checked={trackingEnabled} onCheckedChange={setTrackingEnabled} className="mt-0.5" />
            <span>
              <span className={`block ${label}`}>Collect events</span>
              <span className={`block ${hint}`}>When off, the collector discards events for this site</span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <Switch checked={geolocationEnabled} onCheckedChange={setGeolocationEnabled} className="mt-0.5" />
            <span>
              <span className={`block ${label}`}>Record country</span>
              <span className={`block ${hint}`}>Country only, from network metadata when the collector receives it. Never city or coordinates</span>
            </span>
          </label>
          <fieldset className="flex flex-col gap-3">
            <legend className={`mb-2 ${label}`}>Visitor identity</legend>
            <RadioGroup value={privacyMode} onValueChange={(value) => setPrivacyMode(value as PrivacyMode)} className="flex flex-col gap-3">
              {PRIVACY.map((mode) => (
                <label key={mode.value} className="flex items-start gap-3">
                  <Radio value={mode.value} className="mt-0.5" />
                  <span>
                    <span className={`block ${label}`}>{mode.title}</span>
                    <span className={`block max-w-[64ch] ${hint}`}>{mode.body}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {privacyMode !== site.privacyMode ? (
              <p className="text-[12px] leading-4 text-warning">
                Visitor figures before and after this change are counted differently and should not be compared
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.retention} className={label}>Raw event retention, days</label>
            <Input id={ids.retention} type="number" min={7} max={730} required value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} className="tnum max-w-[120px]" />
            <p className={hint}>Raw events are deleted after this. Daily totals are kept, but filters and hourly views only reach back this far</p>
          </div>
          <SaveRow state={tracking.state} />
        </form>
      </Section>

      <Section title="URL rules" description="How paths are grouped before they are stored">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void urls.save({ allowedQueryParams: lines(queryParams), excludedPathPatterns: lines(excluded) });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.query} className={label}>Query parameters to keep</label>
            <Input id={ids.query} value={queryParams} onChange={(e) => setQueryParams(e.target.value)} placeholder="page, tab" className="max-w-[360px] font-mono" spellCheck={false} />
            <p className={hint}>Everything else is dropped, including all utm_ parameters. Add the same list to the snippet as data-query</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.excluded} className={label}>Excluded paths</label>
            <Textarea id={ids.excluded} rows={4} value={excluded} onChange={(e) => setExcluded(e.target.value)} className="max-w-[360px] font-mono text-[13px]" spellCheck={false} />
            <p className={hint}>One per line. End with * to match a prefix, like /admin*</p>
          </div>
          <SaveRow state={urls.state} />
        </form>
      </Section>

      <Section title="Delete website" description="Collection stops at once. Events, daily totals and goals are then purged and cannot be recovered">
        <Dialog onOpenChange={() => setConfirmText("")}>
          <DialogTrigger render={<Button variant="destructive-outline" size="sm" className="self-start" />}>Delete website</DialogTrigger>
          <DialogPopup className="w-[440px] max-w-[calc(100vw-32px)]">
            <DialogHeader>
              <DialogTitle>Delete {site.name}</DialogTitle>
              <DialogDescription>
                This removes every stored event, rollup and goal for {site.primaryHostname}. Backups keep their own retention window
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-1.5">
              <label htmlFor={ids.confirm} className={label}>
                Type <span className="font-mono text-[12px]">{site.primaryHostname}</span> to confirm
              </label>
              <Input id={ids.confirm} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Keep website</DialogClose>
              <Button
                variant="destructive"
                disabled={confirmText !== site.primaryHostname || deleting}
                onClick={async () => {
                  setDeleting(true);
                  const response = await fetch(`/api/sites/${site.id}`, { method: "DELETE" });
                  if (response.ok) {
                    router.push("/sites");
                    router.refresh();
                  } else setDeleting(false);
                }}
              >
                {deleting ? "Deleting" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      </Section>
    </div>
  );
}

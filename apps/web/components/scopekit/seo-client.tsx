"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OpportunityStatus } from "@scopekit/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/** Re-reads the page from the server while something is in progress there. */
export function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

export async function send(url: string, init: { method: string; body?: unknown }): Promise<{ ok: boolean; message: string | null; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, message: response.ok ? null : typeof data?.message === "string" ? data.message : "Something went wrong", data };
  } catch {
    return { ok: false, message: "The server could not be reached", data: null };
  }
}

const NEXT_STATUS: Record<OpportunityStatus, { status: OpportunityStatus; label: string }[]> = {
  new: [
    { status: "in_progress", label: "Start" },
    { status: "dismissed", label: "Dismiss" },
  ],
  in_progress: [
    { status: "resolved", label: "Mark resolved" },
    { status: "new", label: "Stop" },
  ],
  dismissed: [{ status: "new", label: "Restore" }],
  resolved: [{ status: "new", label: "Reopen" }],
};

export function OpportunityActions({ siteId, id, status, subject }: { siteId: string; id: string; status: OpportunityStatus; subject: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = async (next: OpportunityStatus) => {
    setError(null);
    const result = await send(`/api/sites/${siteId}/seo/opportunities/${id}`, { method: "PATCH", body: { status: next } });
    if (!result.ok) setError(result.message);
    else startTransition(() => router.refresh());
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-1" data-pending={pending || undefined}>
      {NEXT_STATUS[status].map((option, index) => (
        <Button key={option.status} variant={index === 0 ? "outline" : "ghost"} size="xs" disabled={pending} aria-label={`${option.label}: ${subject}`} onClick={() => set(option.status)}>
          {option.label}
        </Button>
      ))}
      {error ? <span role="alert" className="w-full text-right text-[12px] leading-4 text-negative">{error}</span> : null}
    </div>
  );
}

/** Checks one URL against Google's index record, then shows the stored result. */
export function InspectForm({ siteId, origin, disabledReason }: { siteId: string; origin: string; disabledReason?: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(`${origin}/`);
  const [state, setState] = useState<{ status: "idle" | "checking" | "done" | "error"; message?: string }>({ status: "idle" });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ status: "checking" });
    const result = await send(`/api/sites/${siteId}/seo/inspect-url`, { method: "POST", body: { url: url.trim() } });
    if (!result.ok) return setState({ status: "error", message: result.message ?? undefined });
    setState({ status: "done", message: "Checked. The result is in the table below" });
    router.refresh();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="url"
          required
          aria-label="URL to check"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={!!disabledReason}
          className="min-w-0 flex-1 basis-[320px] font-mono"
        />
        <Button type="submit" disabled={!!disabledReason || state.status === "checking"}>
          {state.status === "checking" ? "Checking" : "Check index status"}
        </Button>
      </div>
      <p role="status" className={state.status === "error" ? "min-h-4 text-[12px] leading-4 text-negative" : "min-h-4 text-[12px] leading-4 text-ink-3"}>
        {disabledReason ?? state.message ?? "Reads Google's stored record for the URL. It does not fetch the live page"}
      </p>
    </form>
  );
}

/** Runs a check for a URL from another page, then opens the Indexing report. */
export function InspectButton({ siteId, url, label = "Check again", then, size = "xs" }: { siteId: string; url: string; label?: string; then?: string; size?: "xs" | "sm" }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const run = async () => {
    setState({ busy: true, error: null });
    const result = await send(`/api/sites/${siteId}/seo/inspect-url`, { method: "POST", body: { url } });
    setState({ busy: false, error: result.message });
    if (!result.ok) return;
    if (then) router.push(then);
    else router.refresh();
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="outline" size={size} disabled={state.busy} onClick={run} aria-label={`${label}: ${url}`}>
        {state.busy ? "Checking" : label}
      </Button>
      {state.error ? <span role="alert" className="max-w-[240px] text-right text-[12px] leading-4 text-negative">{state.error}</span> : null}
    </span>
  );
}

export type AvailableProperty = { id: string; label: string; kind: string; permission: string; matches: boolean; readable: boolean; linked: boolean };

/** Lists what a Google account can read and links one property to the site. */
export function PropertyPicker({ siteId, integrationId, siteHostname, properties }: { siteId: string; integrationId: string; siteHostname: string; properties: AvailableProperty[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = async (property: AvailableProperty, confirmMismatch: boolean) => {
    setBusy(property.id);
    setError(null);
    const result = await send(`/api/sites/${siteId}/seo/properties`, { method: "POST", body: { integrationId, property: property.id, confirmMismatch } });
    setBusy(null);
    setConfirming(null);
    if (!result.ok) return setError(result.message);
    router.replace(`/sites/${siteId}/settings/search-console`);
    router.refresh();
  };
  return (
    <div>
      <ul className="flex flex-col">
        {properties.map((property) => (
          <li key={property.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-0">
            <div className="min-w-0">
              <p className="truncate font-mono text-[12px] leading-5 text-ink">{property.label}</p>
              <p className="text-[12px] leading-4 text-ink-3">
                {property.kind} · {property.permission}
                {property.matches ? ` · matches ${siteHostname}` : ""}
              </p>
            </div>
            {property.linked ? (
              <span className="text-[13px] text-ink-2">Linked</span>
            ) : !property.readable ? (
              <span className="max-w-[260px] text-right text-[12px] leading-4 text-ink-3">Not verified for this account</span>
            ) : confirming === property.id ? (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-[12px] leading-4 text-ink-2">Its hostname differs from {siteHostname}</span>
                <Button variant="outline" size="xs" disabled={busy !== null} onClick={() => link(property, true)}>
                  Link anyway
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                variant={property.matches ? "default" : "outline"}
                size="sm"
                disabled={busy !== null}
                onClick={() => (property.matches ? link(property, false) : setConfirming(property.id))}
              >
                {busy === property.id ? "Linking" : "Link property"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="mt-2 text-[13px] leading-5 text-negative">{error}</p> : null}
    </div>
  );
}

export function PropertyActions({ siteId, propertyId, label, canSync }: { siteId: string; propertyId: string; label: string; canSync: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<{ busy: boolean; message: string | null; failed: boolean }>({ busy: false, message: null, failed: false });
  const run = async (url: string, method: string, done: string) => {
    setState({ busy: true, message: null, failed: false });
    const result = await send(url, { method });
    setState({ busy: false, message: result.ok ? done : result.message, failed: !result.ok });
    setConfirming(false);
    router.refresh();
  };
  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[12px] leading-4 text-ink-2">Deletes the search data stored for it</span>
          <Button variant="destructive-outline" size="xs" disabled={state.busy} onClick={() => run(`/api/sites/${siteId}/seo/properties/${propertyId}`, "DELETE", "Disconnected")}>
            Disconnect
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          {canSync ? (
            <Button variant="outline" size="xs" disabled={state.busy} onClick={() => run(`/api/sites/${siteId}/seo/sync`, "POST", "Sync requested")}>
              Sync now
            </Button>
          ) : null}
          <Button variant="ghost" size="xs" aria-label={`Disconnect ${label}`} onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        </span>
      )}
      {state.message ? (
        <span role="status" className={state.failed ? "text-[12px] leading-4 text-negative" : "text-[12px] leading-4 text-ink-3"}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

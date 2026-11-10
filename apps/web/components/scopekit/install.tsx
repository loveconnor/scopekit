"use client";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "honestui/icons";
import { useEffect, useRef, useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {}
      }}
    >
      {copied ? <Check size={14} strokeWidth={1.5} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.5} aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex h-10 items-center justify-between border-b border-line pr-1.5 pl-4">
        <span className="font-mono text-[11px] leading-4 text-ink-3">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-5 text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function buildSnippet(opts: { collectorUrl: string; publicId: string; consent: boolean; queryParams: string[] }): string {
  const attrs = [
    "  defer",
    `  src="${opts.collectorUrl}/script.js"`,
    `  data-site="${opts.publicId}"`,
    ...(opts.consent ? ['  data-mode="consent"'] : []),
    ...(opts.queryParams.length ? [`  data-query="${opts.queryParams.join(",")}"`] : []),
  ];
  return `<script\n${attrs.join("\n")}\n></script>`;
}

type VerifyResult = {
  verified: boolean;
  events: number;
  botEvents: number;
  lastReceivedAt: string | null;
  lastPath: string | null;
  trackingEnabled: boolean;
  hostnames: string[];
};

const MAX_CHECKS = 20;

/** Polls what the collector received in the last 10 minutes. Stops as soon as an event shows up. */
export function VerifyTracking({ siteId }: { siteId: string }) {
  const [run, setRun] = useState(0);
  const { data, isError } = useQuery({
    queryKey: ["verify-tracking", siteId, run],
    enabled: run > 0,
    queryFn: async ({ client, queryKey }): Promise<VerifyResult & { checks: number }> => {
      const response = await fetch(`/api/sites/${siteId}/verify-tracking`, { method: "POST" });
      if (!response.ok) throw new Error("check failed");
      const checks = (client.getQueryState(queryKey)?.dataUpdateCount ?? 0) + 1;
      return { ...((await response.json()) as VerifyResult), checks };
    },
    refetchInterval: (query) => (query.state.data?.verified || query.state.dataUpdateCount >= MAX_CHECKS ? false : 3000),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const polling = run > 0 && !isError && !data?.verified && (data?.checks ?? 0) < MAX_CHECKS;
  const start = () => setRun((n) => n + 1);

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant={data?.verified ? "outline" : "default"} size="sm" onClick={start} disabled={polling}>
        {polling ? "Listening for events" : data?.verified ? "Check again" : "Verify tracking"}
      </Button>
      <div role="status" className="min-h-10 text-[13px] leading-5">
        {isError ? (
          <p className="text-negative">The check could not run. Try again</p>
        ) : data?.verified ? (
          <p className="text-ink">
            <span className="text-positive">Receiving events.</span> {formatNumber(data.events)} in the last 10 minutes
            {data.lastPath ? (
              <>
                , most recently on <span className="font-mono text-[12px]">{data.lastPath}</span>
              </>
            ) : null}
          </p>
        ) : polling ? (
          <p className="text-ink-2">Open the site in another tab. This checks every 3 seconds for a minute</p>
        ) : data ? (
          <div className="text-ink-2">
            <p className="text-ink">No events in the last 10 minutes</p>
            <ul className="mt-1 list-disc pl-4">
              {!data.trackingEnabled ? <li>Tracking is turned off for this site</li> : null}
              {data.botEvents > 0 ? <li>{formatNumber(data.botEvents)} events arrived but were flagged as automated traffic</li> : null}
              <li>
                The page must be served from <span className="font-mono text-[12px]">{data.hostnames.join(", ")}</span>
              </li>
              <li>Ad and script blockers stop the snippet from loading</li>
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageview } from "./index";

export type ScopeKitProps = {
  /** Public site identifier, e.g. `sk_site_...`. */
  siteId: string;
  /** Collector origin, e.g. `https://collect.example.com`. */
  collectorUrl: string;
  /** Wait for `enableTracking()` before sending or storing anything. */
  consentMode?: boolean;
  /** Query parameters that identify different content and should stay in the path. */
  allowedQueryParams?: string[];
  trackOutboundLinks?: boolean;
  trackDownloads?: boolean;
};

/**
 * Drop into the root layout. Loads the tracker once (safe under React Strict Mode) and
 * reports App Router navigations explicitly; the tracker ignores repeats for the same URL,
 * so this never double counts alongside its own history instrumentation.
 */
export function ScopeKit({ siteId, collectorUrl, consentMode, allowedQueryParams, trackOutboundLinks, trackDownloads }: ScopeKitProps) {
  const pathname = usePathname();

  useEffect(() => {
    if (document.querySelector("script[data-site]")) return;
    const script = document.createElement("script");
    script.defer = true;
    script.src = `${collectorUrl.replace(/\/$/, "")}/script.js`;
    script.setAttribute("data-site", siteId);
    if (consentMode) script.setAttribute("data-mode", "consent");
    if (allowedQueryParams?.length) script.setAttribute("data-query", allowedQueryParams.join(","));
    if (trackOutboundLinks) script.setAttribute("data-outbound", "");
    if (trackDownloads) script.setAttribute("data-downloads", "");
    document.head.appendChild(script);
  }, [siteId, collectorUrl, consentMode, allowedQueryParams, trackOutboundLinks, trackDownloads]);

  useEffect(() => {
    trackPageview();
  }, [pathname]);

  return null;
}

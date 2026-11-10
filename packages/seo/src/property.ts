import type { GscPropertyType } from "@scopekit/contracts";

const stripWww = (host: string) => host.replace(/^www\./, "");

export type ParsedProperty = { id: string; type: GscPropertyType; hostname: string; label: string };

/**
 * Search Console has two kinds of property. A domain property (`sc-domain:example.com`)
 * covers every protocol and subdomain; a URL-prefix property (`https://www.example.com/blog/`)
 * covers only URLs that start with it.
 */
export function parseProperty(id: string): ParsedProperty | null {
  if (id.startsWith("sc-domain:")) {
    const hostname = id.slice("sc-domain:".length).toLowerCase();
    return hostname ? { id, type: "domain", hostname, label: hostname } : null;
  }
  try {
    const url = new URL(id);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { id, type: "url_prefix", hostname: url.hostname.toLowerCase(), label: `${url.host}${url.pathname === "/" ? "" : url.pathname}` };
  } catch {
    return null;
  }
}

/** Whether a property plausibly holds this site's search data, judged by hostname. */
export function propertyMatchesSite(property: ParsedProperty, siteHostnames: string[]): boolean {
  const hosts = siteHostnames.map((h) => h.toLowerCase().replace(/:\d+$/, ""));
  if (property.type === "domain") return hosts.some((h) => h === property.hostname || h.endsWith(`.${property.hostname}`));
  return hosts.some((h) => stripWww(h) === stripWww(property.hostname));
}

/** Whether a URL belongs to the property, which the URL Inspection API requires. */
export function urlInProperty(url: string, property: ParsedProperty): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (property.type === "domain") return host === property.hostname || host.endsWith(`.${property.hostname}`);
  return parsed.href.startsWith(property.id);
}

/** Deep link into the Search Console performance report for the property. */
export function searchConsoleLink(propertyId: string, filter?: { page?: string; query?: string }): string {
  const params = new URLSearchParams({ resource_id: propertyId });
  if (filter?.page) params.set("page", `!${filter.page}`);
  if (filter?.query) params.set("query", `!${filter.query}`);
  return `https://search.google.com/search-console/performance/search-analytics?${params}`;
}

export const PERMISSION_LABELS: Record<string, string> = {
  siteOwner: "Owner",
  siteFullUser: "Full user",
  siteRestrictedUser: "Restricted user",
  siteUnverifiedUser: "Unverified",
};

/** Unverified users cannot read search data, so those properties cannot be linked. */
export const canReadProperty = (permissionLevel: string) => permissionLevel !== "siteUnverifiedUser";

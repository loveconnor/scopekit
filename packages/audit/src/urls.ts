/**
 * One spelling per crawlable URL: no fragment, no default port, and only the query
 * parameters the site lists as meaningful. Path case and trailing slashes are kept, because
 * servers can treat them as different pages.
 */
export function normalizeCrawlUrl(raw: string, allowedQueryParams: readonly string[] = [], base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => allowedQueryParams.includes(key)).sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (!url.pathname) url.pathname = "/";
  return url.toString();
}

export const hostOf = (url: string) => new URL(url).host.toLowerCase();

export function inScope(url: string, hosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    return hosts.has(parsed.host.toLowerCase()) || (!parsed.port && hosts.has(parsed.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

/** `/admin` excludes the path and everything under it; `/tmp*` excludes by prefix. */
export function isExcludedCrawlPath(pathname: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
    const trimmed = pattern.replace(/\/$/, "") || "/";
    return pathname === trimmed || pathname.startsWith(`${trimmed === "/" ? "" : trimmed}/`);
  });
}

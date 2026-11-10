import { COLLECT_LIMITS } from "@scopekit/contracts";

/** Keys that are never stored, whether they arrive as a query parameter or an event property. */
export const SENSITIVE_KEY =
  /(e-?mail|pass(word|wd)?|token|auth(?!or)|secret|session|phone|ssn|credit|card|api[-_]?key|signature|address|name$)/i;

export const DEFAULT_EXCLUDED_PATHS = ["/admin*", "/preview*", "/api/*", "/_next/*"];

const MAX_PATH_LENGTH = 512;

/**
 * Canonical path used for grouping. Fragments are dropped, duplicate and trailing slashes
 * collapse, case is preserved (paths can be case-sensitive), and only allowlisted query
 * parameters survive, sorted so `?b=1&a=2` and `?a=2&b=1` group together.
 */
export function normalizePath(raw: string, allowedQueryParams: readonly string[] = []): string {
  let url: URL;
  try {
    // A leading `//` would be read as a protocol-relative URL and swallow the first segment.
    url = new URL(raw.replace(/^\/{2,}/, "/"), "http://scopekit.invalid");
  } catch {
    return "/";
  }
  let pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  const kept: [string, string][] = [];
  if (allowedQueryParams.length > 0) {
    const allowed = new Set(allowedQueryParams);
    for (const [key, value] of url.searchParams) {
      if (!allowed.has(key) || SENSITIVE_KEY.test(key) || key.toLowerCase().startsWith("utm_")) continue;
      kept.push([key, value.slice(0, 100)]);
    }
    kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  }
  const query = kept.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const result = query ? `${pathname}?${query}` : pathname;
  return result.slice(0, MAX_PATH_LENGTH);
}

/** `/admin*` is a prefix match; anything without a trailing `*` must match exactly. */
export function matchesPathPattern(path: string, pattern: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  const exact = pattern.length > 1 && pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  return pathname === exact;
}

export function isExcludedPath(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(path, pattern));
}

const PROP_KEY = /^[A-Za-z0-9_.-]{1,40}$/;
const LOOKS_LIKE_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LOOKS_LIKE_LONG_NUMBER = /(\d[\s().-]?){9,}/;

export type SafeProps = Record<string, string | number | boolean>;

/**
 * Keeps flat, small, non-identifying properties. Anything else is dropped key by key so a
 * single bad property never loses the whole event. This is a safety net, not a substitute
 * for reviewing what a site sends.
 */
export function sanitizeProps(input: unknown): { props: SafeProps; dropped: string[] } {
  const props: SafeProps = {};
  const dropped: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { props, dropped };

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(props).length >= COLLECT_LIMITS.maxPropKeys || !PROP_KEY.test(key) || SENSITIVE_KEY.test(key)) {
      dropped.push(key);
      continue;
    }
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      props[key] = value;
    } else if (
      typeof value === "string" &&
      value.length <= COLLECT_LIMITS.maxStringLength &&
      !LOOKS_LIKE_EMAIL.test(value) &&
      !LOOKS_LIKE_LONG_NUMBER.test(value)
    ) {
      props[key] = value;
    } else {
      dropped.push(key);
    }
  }
  return { props, dropped };
}

/** Accepts `example.com`, `https://example.com/path` and similar; returns the origin and hostname. */
export function normalizeOrigin(input: string): { origin: string; hostname: string } {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https sites are supported");
  if (url.username || url.password) throw new Error("URLs with credentials are not supported");
  if (!url.hostname.includes(".") && url.hostname !== "localhost") throw new Error("Enter a full domain like example.com");
  return { origin: url.origin, hostname: url.host.toLowerCase() };
}

export function stripWww(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

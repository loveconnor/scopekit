import { stripWww } from "./normalize";

export const DIRECT_SOURCE = "(direct)";
export const NO_MEDIUM = "(none)";

const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]{2,6}$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\.(com|co\.[a-z]{2})$/, "yahoo"],
  [/(^|\.)yandex\.[a-z.]{2,6}$/, "yandex"],
  [/(^|\.)baidu\.com$/, "baidu"],
  [/(^|\.)ecosia\.org$/, "ecosia"],
  [/^search\.brave\.com$/, "brave"],
  [/(^|\.)kagi\.com$/, "kagi"],
  [/(^|\.)startpage\.com$/, "startpage"],
];

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.me)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(twitter\.com|x\.com)$|^t\.co$/, "x"],
  [/(^|\.)(linkedin\.com)$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)(reddit\.com|redd\.it)$/, "reddit"],
  [/(^|\.)(youtube\.com)$|^youtu\.be$/, "youtube"],
  [/(^|\.)pinterest\.[a-z.]{2,6}$/, "pinterest"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)threads\.(net|com)$/, "threads"],
  [/(^|\.)bsky\.app$/, "bluesky"],
  [/^news\.ycombinator\.com$/, "hackernews"],
];

export type SourceInput = {
  referrer?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
  /** Hostnames that belong to the site, so its own pages never count as an external referrer. */
  ownHostnames: readonly string[];
};

export type ClassifiedSource = {
  source: string;
  medium: string;
  campaign: string | null;
  referrerDomain: string | null;
};

function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

const clean = (value: string | null | undefined) => {
  const trimmed = value?.trim().toLowerCase().slice(0, 100);
  return trimmed ? trimmed : null;
};

/**
 * Only the referrer's domain is kept; the full URL can carry sensitive query strings.
 * A missing referrer is "Direct / unknown": it is not proof of direct navigation.
 */
export function classifySource(input: SourceInput): ClassifiedSource {
  const own = new Set(input.ownHostnames.map((h) => stripWww(h.split(":")[0]!.toLowerCase())));
  const host = referrerHost(input.referrer);
  const bare = host ? stripWww(host) : null;
  const referrerDomain = bare && !own.has(bare) ? bare : null;

  const utmSource = clean(input.utm?.source);
  const campaign = clean(input.utm?.campaign);
  if (utmSource) {
    return { source: utmSource, medium: clean(input.utm?.medium) ?? "(not set)", campaign, referrerDomain };
  }
  if (!referrerDomain) return { source: DIRECT_SOURCE, medium: NO_MEDIUM, campaign, referrerDomain: null };

  for (const [pattern, name] of SEARCH_ENGINES) {
    if (pattern.test(referrerDomain)) return { source: name, medium: "organic", campaign, referrerDomain };
  }
  for (const [pattern, name] of SOCIAL) {
    if (pattern.test(referrerDomain)) return { source: name, medium: "social", campaign, referrerDomain };
  }
  return { source: referrerDomain, medium: "referral", campaign, referrerDomain };
}

export function sourceLabel(source: string, medium: string): string {
  if (source === DIRECT_SOURCE) return "Direct / unknown";
  return `${source} / ${medium}`;
}

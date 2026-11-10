import "server-only";
import { parseViewState, type SearchParams } from "./params";
import { loadSite } from "./reports";

/** Resolves the site and URL state shared by every site report page. */
export async function loadSiteView(params: Promise<{ siteId: string }>, searchParams: Promise<SearchParams>) {
  const [{ siteId }, sp] = await Promise.all([params, searchParams]);
  const site = await loadSite(siteId);
  return { site, params: sp, view: parseViewState(sp), base: `/sites/${site.id}` };
}

export const SERIES = {
  pageviews: { key: "pageviews", label: "Pageviews", light: "#0f0f0f", dark: "#f5f5f5", emphasis: true },
  sessions: { key: "sessions", label: "Sessions", light: "#8a8a8a", dark: "#8a8a8a", emphasis: false },
  visitors: { key: "visitors", label: "Visitors (estimated)", light: "#8a8a8a", dark: "#8a8a8a", emphasis: false, dashed: true },
} as const;

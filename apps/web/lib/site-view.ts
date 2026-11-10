import "server-only";
import { parseViewState, type SearchParams } from "./params";
import { defaultToTodayForNewSites, loadSite } from "./reports";
import { viewParams } from "./view-state";

/** Resolves the site and URL state shared by every site report page. */
export async function loadSiteView(params: Promise<{ siteId: string }>, searchParams: Promise<SearchParams>) {
  const [{ siteId }, raw] = await Promise.all([params, searchParams]);
  const site = await loadSite(siteId);
  const sp = await viewParams(raw);
  return { site, params: sp, view: defaultToTodayForNewSites(parseViewState(sp), [site]), base: `/sites/${site.id}` };
}

export const SERIES = {
  pageviews: { key: "pageviews", label: "Pageviews", light: "#0f0f0f", dark: "#f5f5f5", emphasis: true },
  sessions: { key: "sessions", label: "Sessions", light: "#8a8a8a", dark: "#8a8a8a", emphasis: false },
  visitors: { key: "visitors", label: "Visitors (estimated)", light: "#8a8a8a", dark: "#8a8a8a", emphasis: false, dashed: true },
} as const;

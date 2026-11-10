import "server-only";
import { METRIC_DEFINITIONS_VERSION } from "@scopekit/contracts";
import type { SiteDetail } from "@scopekit/db";
import type { GscRange } from "@scopekit/seo";
import { fail, searchParamsOf } from "./api";
import { parseViewState } from "./params";
import { isReady, loadSearchConnection, searchRange, type ReadyConnection } from "./seo";

/** Resolves the connection and finalized range for a Search Console API route, or fails with the reason. */
export async function seoRequest(request: Request, site: SiteDetail) {
  const params = searchParamsOf(request);
  const conn = await loadSearchConnection(site.id, typeof params.property === "string" ? params.property : undefined);
  if (!isReady(conn)) fail(409, conn.state, "Search Console data is not available for this site yet");
  const view = parseViewState(params);
  const range = await searchRange(view, conn.active.finalizedThrough);
  return { params, conn, view, range };
}

/** Envelope for Search Console responses: dates are Pacific Time and always finalized. */
export function seoEnvelope(site: SiteDetail, conn: ReadyConnection, range: GscRange) {
  return {
    siteId: site.id,
    property: conn.active.externalPropertyId,
    range: { from: range.from, to: range.to, timezone: "America/Los_Angeles" },
    source: "gsc" as const,
    freshThrough: conn.active.finalizedThrough,
    isPartial: false,
    metricDefinitionsVersion: METRIC_DEFINITIONS_VERSION,
  };
}

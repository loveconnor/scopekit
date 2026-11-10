import { fail, readJson, withSite } from "@/lib/api";
import { INSPECTION_DAILY_CAP, pacificToday, searchConsoleAccess } from "@/lib/seo";
import { startOfLocalDay } from "@scopekit/analytics";
import { GSC_TIMEZONE, inspectUrlSchema } from "@scopekit/contracts";
import { countInspectionsSince, getIntegration, insertInspection, listSiteProperties, markIntegrationNeedsReauth } from "@scopekit/db";
import { GoogleApiError, GoogleAuthError, GooglePermissionError, GoogleRateLimitError, inspectUrl, parseProperty, urlInProperty, withAccessToken } from "@scopekit/seo";

/**
 * Asks Google for its stored index record of one URL. This is a deliberate, owner-triggered
 * call (reports never call Google), capped per property and day.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/inspect-url">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const input = await readJson(request, inspectUrlSchema);
    const properties = (await listSiteProperties(db, site.id)).filter((p) => p.enabled);
    if (!properties.length) fail(409, "not_connected", "No Search Console property is linked to this site");
    if (properties.every((p) => p.isDemo)) fail(400, "demo_site", "Demo properties are synthetic and cannot be inspected");
    // Prefer the named property, otherwise the first one that contains the URL.
    const candidates = input.propertyId ? properties.filter((p) => p.id === input.propertyId) : properties;
    const property = candidates.find((p) => {
      const parsed = parseProperty(p.externalPropertyId);
      return !p.isDemo && parsed && urlInProperty(input.url, parsed);
    });
    if (!property) fail(422, "url_outside_property", "This URL is not part of a linked Search Console property");
    if (property.connectionStatus !== "connected") fail(409, "needs_reauth", "Reconnect the Google account to check URLs");
    const access = searchConsoleAccess();
    const integration = await getIntegration(db, property.integrationId);
    if (!access || !integration) fail(503, "not_configured", "Search Console is not set up on this server");

    const used = await countInspectionsSince(db, property.id, startOfLocalDay(pacificToday(), GSC_TIMEZONE));
    if (used >= INSPECTION_DAILY_CAP) fail(429, "inspection_cap", `The daily limit of ${INSPECTION_DAILY_CAP} checks for this property is used up. It resets at midnight Pacific Time`);

    let result;
    try {
      result = await withAccessToken(db, integration, access, (token) => inspectUrl(access.google, token, property.externalPropertyId, input.url));
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        await markIntegrationNeedsReauth(db, integration.id, error.message);
        fail(409, "needs_reauth", "Google access was revoked. Reconnect the account to check URLs");
      }
      if (error instanceof GoogleRateLimitError) fail(429, "google_rate_limit", "Google's inspection quota is used up for now. Try again later");
      if (error instanceof GooglePermissionError) fail(403, "google_forbidden", "This Google account may not inspect URLs for the property");
      if (error instanceof GoogleApiError && error.status === 400) fail(422, "google_rejected", "Google could not inspect this URL");
      fail(502, "google_unavailable", "Google did not answer. Try again in a moment");
    }

    const index = result.indexStatusResult ?? {};
    const crawl = index.lastCrawlTime ? new Date(index.lastCrawlTime) : null;
    const row = await insertInspection(db, {
      siteId: site.id,
      propertyId: property.id,
      url: input.url,
      indexVerdict: index.verdict ?? null,
      coverageState: index.coverageState ?? null,
      crawledAs: index.crawledAs ?? null,
      googleCanonical: index.googleCanonical ?? null,
      userCanonical: index.userCanonical ?? null,
      lastCrawlAt: crawl && !Number.isNaN(crawl.getTime()) ? crawl : null,
      robotsTxtState: index.robotsTxtState ?? null,
      indexingState: index.indexingState ?? null,
      pageFetchState: index.pageFetchState ?? null,
      inspectionLink: result.inspectionResultLink ?? null,
      raw: result as Record<string, unknown>,
    });
    return Response.json({ id: row.id, url: row.url, indexVerdict: row.indexVerdict, coverageState: row.coverageState, checkedAt: row.checkedAt, source: "gsc", remainingToday: INSPECTION_DAILY_CAP - used - 1 }, { status: 201 });
  });
}

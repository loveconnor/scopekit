import { fail, readJson, withSite } from "@/lib/api";
import { backfillTargetFor, searchConsoleAccess } from "@/lib/seo";
import { linkPropertySchema } from "@scopekit/contracts";
import { getIntegration, linkProperty, markIntegrationNeedsReauth, PropertyAlreadyLinkedError, writeAuditLog } from "@scopekit/db";
import { canReadProperty, GoogleAuthError, listGscSites, parseProperty, propertyMatchesSite, withAccessToken } from "@scopekit/seo";

/** Links a Search Console property to the site and queues its first sync. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/properties">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const input = await readJson(request, linkPropertySchema);
    if (site.isDemo) fail(400, "demo_site", "Demo sites cannot be connected to Search Console");
    const access = searchConsoleAccess();
    if (!access) fail(503, "not_configured", "Search Console is not set up on this server");
    const integration = await getIntegration(db, input.integrationId);
    if (!integration || integration.ownerUserId !== user.id) fail(404, "integration_not_found", "No Google account with that ID");

    // The property must be one Google says this account can read; the request body is not trusted for that.
    let entries;
    try {
      entries = await withAccessToken(db, integration, access, (token) => listGscSites(access.google, token));
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        await markIntegrationNeedsReauth(db, integration.id, error.message);
        fail(409, "needs_reauth", "This Google account needs to be reconnected");
      }
      fail(502, "google_unavailable", "Google did not answer. Try again in a moment");
    }
    const entry = entries.find((e) => e.siteUrl === input.property);
    const parsed = entry ? parseProperty(entry.siteUrl) : null;
    if (!entry || !parsed) fail(404, "property_not_found", "This Google account has no such property");
    if (!canReadProperty(entry.permissionLevel)) fail(403, "property_unverified", "This account is not verified for the property, so Google will not return its data");
    if (!propertyMatchesSite(parsed, site.hostnames) && !input.confirmMismatch) {
      fail(409, "property_mismatch", `${parsed.label} does not match ${site.primaryHostname}. Confirm to link it anyway`);
    }

    try {
      const id = await linkProperty(db, {
        siteId: site.id,
        integrationId: integration.id,
        externalPropertyId: entry.siteUrl,
        externalPropertyType: parsed.type,
        permissionLevel: entry.permissionLevel,
        backfillTarget: backfillTargetFor(),
      });
      await writeAuditLog(db, {
        actorId: user.id,
        siteId: site.id,
        entity: "integration",
        action: "property_linked",
        summary: `${site.name}: Search Console property ${parsed.label} linked`,
        metadata: { property: entry.siteUrl.slice(0, 200) },
      });
      return Response.json({ id }, { status: 201 });
    } catch (error) {
      if (error instanceof PropertyAlreadyLinkedError) fail(409, "already_linked", "This property is already linked to the site");
      throw error;
    }
  });
}

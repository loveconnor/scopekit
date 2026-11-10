import { fail, withSite } from "@/lib/api";
import { searchConsoleAccess } from "@/lib/seo";
import { deleteIntegration, getIntegration, getProperty, unlinkProperty, writeAuditLog } from "@scopekit/db";
import { decryptSecret, parseProperty, revokeToken } from "@scopekit/seo";

/**
 * Unlinks a property and deletes the search data stored for it. When that was the account's
 * last link, the grant is revoked at Google and the stored tokens are deleted as well.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/sites/[siteId]/seo/properties/[propertyId]">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const { propertyId } = await ctx.params;
    const property = await getProperty(db, propertyId);
    if (!property || property.siteId !== site.id) fail(404, "property_not_found", "No linked property with that ID");
    if (property.isDemo) fail(400, "demo_site", "Demo data is removed with `npm run demo:clear`");
    const result = await unlinkProperty(db, site.id, propertyId);
    if (!result) fail(404, "property_not_found", "No linked property with that ID");

    let accountRemoved = false;
    if (result.remaining === 0) {
      const integration = await getIntegration(db, result.integrationId);
      const access = searchConsoleAccess();
      if (integration?.encryptedRefreshToken && access) {
        try {
          await revokeToken(access.google, decryptSecret(integration.encryptedRefreshToken, access.masterKey));
        } catch {
          // Undecryptable tokens cannot be revoked; they are deleted below either way.
        }
      }
      await deleteIntegration(db, result.integrationId);
      accountRemoved = true;
    }
    await writeAuditLog(db, {
      actorId: user.id,
      siteId: site.id,
      entity: "integration",
      action: "property_unlinked",
      summary: `${site.name}: Search Console property ${parseProperty(property.externalPropertyId)?.label ?? "property"} unlinked${accountRemoved ? " and Google access revoked" : ""}`,
    });
    return Response.json({ ok: true, accountRemoved });
  });
}

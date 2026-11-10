import { apiError, readJson, withSite } from "@/lib/api";
import { updateSiteSchema } from "@scopekit/contracts";
import { HostnameTakenError, softDeleteSite, updateSite, writeAuditLog } from "@scopekit/db";

export async function GET(request: Request, ctx: RouteContext<"/api/sites/[siteId]">) {
  return withSite(request, ctx.params, async ({ site }) => Response.json({ site }));
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]">) {
  return withSite(request, ctx.params, async ({ db, site, user, requestId }) => {
    const patch = await readJson(request, updateSiteSchema);
    try {
      await updateSite(db, site, patch);
    } catch (error) {
      if (error instanceof HostnameTakenError) return apiError(409, "hostname_taken", error.message, undefined, requestId);
      throw error;
    }
    const changed = Object.keys(patch);
    if (changed.length) {
      await writeAuditLog(db, {
        actorId: user.id,
        siteId: site.id,
        entity: "site",
        action: patch.privacyMode && patch.privacyMode !== site.privacyMode ? "privacy_mode_changed" : "updated",
        summary:
          patch.privacyMode && patch.privacyMode !== site.privacyMode
            ? `${site.name}: privacy mode changed from ${site.privacyMode} to ${patch.privacyMode}`
            : `${site.name}: updated ${changed.join(", ")}`,
      });
    }
    return Response.json({ ok: true });
  });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/sites/[siteId]">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    await softDeleteSite(db, site.id);
    await writeAuditLog(db, {
      actorId: user.id,
      entity: "site",
      action: "deleted",
      summary: `Deleted ${site.name} (${site.primaryHostname}). Stored data is being purged`,
    });
    // Collection has already stopped; the worker removes events and rollups asynchronously.
    return Response.json({ ok: true, purge: "scheduled" }, { status: 202 });
  });
}

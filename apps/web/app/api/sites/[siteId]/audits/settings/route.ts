import { fail, readJson, withSite } from "@/lib/api";
import { urlOnSite } from "@/lib/health";
import { crawlSettingsSchema } from "@scopekit/contracts";
import { saveCrawlSettings, writeAuditLog } from "@scopekit/db";

export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]/audits/settings">) {
  return withSite(request, ctx.params, async ({ db, site, user }) => {
    const input = await readJson(request, crawlSettingsSchema);
    if (input.sitemapUrl && !urlOnSite(site, input.sitemapUrl)) fail(422, "validation_failed", "The sitemap must be on one of the site's hostnames");
    await saveCrawlSettings(db, site.id, { ...input, ...(input.sitemapUrl === undefined ? {} : { sitemapUrl: input.sitemapUrl || null }) });
    await writeAuditLog(db, { actorId: user.id, siteId: site.id, entity: "audit", action: "settings_changed", summary: `${site.name}: crawl settings changed` });
    return Response.json({ ok: true });
  });
}

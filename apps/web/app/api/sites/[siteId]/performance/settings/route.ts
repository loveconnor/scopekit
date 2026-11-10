import { fail, readJson, withSite } from "@/lib/api";
import { urlOnSite } from "@/lib/health";
import { performanceSettingsSchema } from "@scopekit/contracts";
import { saveCrawlSettings } from "@scopekit/db";

/** The pages checked weekly besides the homepage, ten at most. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/sites/[siteId]/performance/settings">) {
  return withSite(request, ctx.params, async ({ db, site }) => {
    const { performanceUrls } = await readJson(request, performanceSettingsSchema);
    const outside = performanceUrls.find((url) => !urlOnSite(site, url));
    if (outside) fail(422, "url_outside_site", `${outside} is not on one of the site's hostnames`);
    await saveCrawlSettings(db, site.id, { performanceUrls: [...new Set(performanceUrls)] });
    return Response.json({ ok: true });
  });
}

import { fail, redirectTo, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { rememberAttempt } from "@/lib/google-oauth";
import { searchConsoleAccess } from "@/lib/seo";
import { getIntegration, getSite } from "@scopekit/db";
import { buildAuthUrl, randomToken } from "@scopekit/seo";

/** Starts the Google authorization-code flow (PKCE, read-only Search Console scope) for one site. */
export async function GET(request: Request) {
  return withUser(request, async ({ user, db }) => {
    const params = new URL(request.url).searchParams;
    const site = await getSite(db, params.get("siteId") ?? "", { includeDemo: env.demo });
    if (!site) fail(404, "site_not_found", "No website with that ID");
    if (site.isDemo) fail(400, "demo_site", "Demo sites cannot be connected to Search Console");
    const access = searchConsoleAccess();
    if (!access) return redirectTo(`/sites/${site.id}/settings/search-console?gsc_error=not_configured`);

    const integrationId = params.get("integrationId");
    if (integrationId) {
      const integration = await getIntegration(db, integrationId);
      if (!integration || integration.ownerUserId !== user.id) fail(404, "integration_not_found", "No Google account with that ID");
    }
    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    await rememberAttempt({ state, codeVerifier, siteId: site.id, userId: user.id, integrationId }, access.masterKey);
    return redirectTo(buildAuthUrl(access.google, { state, codeVerifier }));
  });
}

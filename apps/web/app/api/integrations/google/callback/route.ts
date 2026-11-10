import { redirectTo, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { takeAttempt } from "@/lib/google-oauth";
import { searchConsoleAccess } from "@/lib/seo";
import { createIntegration, getIntegration, getSite, requestIntegrationSync, saveIntegrationTokens, writeAuditLog } from "@scopekit/db";
import { encryptSecret, exchangeCode, GSC_SCOPE, listGscSites, parseProperty, safeEqual } from "@scopekit/seo";

/** A label that tells accounts apart without asking Google for the owner's email address. */
function labelFor(properties: string[]): string {
  const names = properties.map((id) => parseProperty(id)?.label).filter((label): label is string => !!label);
  if (!names.length) return "Google account with no Search Console properties";
  return `Google account with ${names[0]}${names.length > 1 ? ` and ${names.length - 1} more` : ""}`;
}

/**
 * Finishes the Google flow. Every failure lands back on the site's Search Console settings
 * with a reason; local analytics are never affected by what happens here.
 */
export async function GET(request: Request) {
  return withUser(request, async ({ user, db }) => {
    const params = new URL(request.url).searchParams;
    const access = searchConsoleAccess();
    if (!access) return redirectTo("/sites?gsc_error=not_configured");

    const attempt = await takeAttempt(access.masterKey);
    const state = params.get("state") ?? "";
    if (!attempt || attempt.userId !== user.id || !safeEqual(attempt.state, state)) return redirectTo("/sites?gsc_error=state");
    const back = (reason?: string, account?: string) => {
      const query = new URLSearchParams(reason ? { gsc_error: reason } : account ? { account } : {});
      return redirectTo(`/sites/${attempt.siteId}/settings/search-console${query.size ? `?${query}` : ""}`);
    };

    const site = await getSite(db, attempt.siteId, { includeDemo: env.demo });
    if (!site) return redirectTo("/sites?gsc_error=state");
    if (params.get("error")) return back(params.get("error") === "access_denied" ? "denied" : "google");
    const code = params.get("code");
    if (!code) return back("google");

    let tokens;
    try {
      tokens = await exchangeCode(access.google, { code, codeVerifier: attempt.codeVerifier });
    } catch {
      return back("exchange");
    }
    // Without a refresh token the worker could not sync after the first hour.
    if (!tokens.refreshToken) return back("no_refresh_token");
    if (tokens.scope && !tokens.scope.split(/\s+/).includes(GSC_SCOPE)) return back("scope");

    let properties: string[] = [];
    try {
      properties = (await listGscSites(access.google, tokens.accessToken)).map((entry) => entry.siteUrl);
    } catch {
      // The label is cosmetic; the property picker reports API problems itself.
    }
    const stored = {
      encryptedAccessToken: encryptSecret(tokens.accessToken, access.masterKey),
      encryptedRefreshToken: encryptSecret(tokens.refreshToken, access.masterKey),
      expiresAt: tokens.expiresAt,
      scope: tokens.scope || GSC_SCOPE,
      accountLabel: labelFor(properties),
    };

    let integrationId = attempt.integrationId;
    const existing = integrationId ? await getIntegration(db, integrationId) : null;
    if (existing && existing.ownerUserId === user.id) {
      await saveIntegrationTokens(db, existing.id, stored);
      await requestIntegrationSync(db, existing.id);
    } else {
      integrationId = await createIntegration(db, { ownerUserId: user.id, isDemo: false, ...stored });
    }
    await writeAuditLog(db, {
      actorId: user.id,
      siteId: site.id,
      entity: "integration",
      action: existing ? "reconnected" : "connected",
      summary: `${site.name}: Google account ${existing ? "reconnected" : "connected"} for Search Console`,
    });
    return back(undefined, integrationId!);
  });
}

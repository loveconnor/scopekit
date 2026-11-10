import { pkceChallenge } from "./crypto";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  webmastersUrl: string;
  inspectionUrl: string;
};

/**
 * Null when the OAuth client is not configured. SCOPEKIT_GOOGLE_BASE_URL points every Google
 * endpoint at one origin and exists for the test suite's stand-in server only.
 */
export function googleConfigFromEnv(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const appUrl = (env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const base = env.SCOPEKIT_GOOGLE_BASE_URL?.replace(/\/$/, "");
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${appUrl}/api/integrations/google/callback`,
    authUrl: base ? `${base}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: base ? `${base}/token` : "https://oauth2.googleapis.com/token",
    revokeUrl: base ? `${base}/revoke` : "https://oauth2.googleapis.com/revoke",
    webmastersUrl: base ? `${base}/webmasters/v3` : "https://www.googleapis.com/webmasters/v3",
    inspectionUrl: base ? `${base}/v1` : "https://searchconsole.googleapis.com/v1",
  };
}

/** Messages never contain tokens, so they are safe to store and show. */
export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}
/** The grant is gone (revoked, expired or wrong client). Only the owner reconnecting fixes it. */
export class GoogleAuthError extends GoogleApiError {
  constructor(message: string) {
    super(401, "auth", message);
    this.name = "GoogleAuthError";
  }
}
export class GoogleRateLimitError extends GoogleApiError {
  constructor(
    message: string,
    public retryAfterMs: number | null,
  ) {
    super(429, "rate_limit", message);
    this.name = "GoogleRateLimitError";
  }
}
/** The account is fine but may not read this property. */
export class GooglePermissionError extends GoogleApiError {
  constructor(message: string) {
    super(403, "forbidden", message);
    this.name = "GooglePermissionError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ OAuth ------------------------------ */

/** Authorization-code flow with PKCE, read-only scope, and offline access for background sync. */
export function buildAuthUrl(config: GoogleConfig, input: { state: string; codeVerifier: string }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GSC_SCOPE,
    access_type: "offline",
    // Google only returns a refresh token when consent is shown.
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
    code_challenge: pkceChallenge(input.codeVerifier),
    code_challenge_method: "S256",
  });
  return `${config.authUrl}?${params}`;
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date; scope: string };

async function tokenRequest(config: GoogleConfig, fields: Record<string, string>): Promise<TokenSet> {
  let response: Response;
  try {
    response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleApiError(0, "network", "Could not reach Google to exchange the token");
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body || typeof body.access_token !== "string") {
    const code = typeof body?.error === "string" ? body.error : "";
    if (code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client") {
      throw new GoogleAuthError(code === "invalid_grant" ? "Google access was revoked or has expired" : "Google rejected the OAuth client credentials");
    }
    if (response.status === 429) throw new GoogleRateLimitError("Google rate limit reached", null);
    throw new GoogleApiError(response.status, code || "token_error", `Google token request failed (${code || response.status})`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: new Date(Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000),
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

export const exchangeCode = (config: GoogleConfig, input: { code: string; codeVerifier: string }) =>
  tokenRequest(config, { grant_type: "authorization_code", code: input.code, code_verifier: input.codeVerifier, redirect_uri: config.redirectUri });

export const refreshAccessToken = (config: GoogleConfig, refreshToken: string) =>
  tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken });

/** Best effort: a token that is already invalid needs no revoking. */
export async function revokeToken(config: GoogleConfig, token: string): Promise<boolean> {
  try {
    const response = await fetch(config.revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/* ------------------------------ API ------------------------------ */

async function call<T>(accessToken: string, url: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: { authorization: `Bearer ${accessToken}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      if (attempt < 2) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new GoogleApiError(0, "network", "Could not reach Google");
    }
    if (response.ok) return (await response.json()) as T;

    const body = (await response.json().catch(() => null)) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } } | null;
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
    const message = body?.error?.message?.slice(0, 200) ?? `Google returned ${response.status}`;
    if (response.status === 401) throw new GoogleAuthError("Google no longer accepts the stored access");
    if (response.status === 429 || (response.status === 403 && /quota|ratelimit|limitexceeded|resource_exhausted/i.test(reason))) {
      const header = Number(response.headers.get("retry-after"));
      throw new GoogleRateLimitError(message, Number.isFinite(header) && header > 0 ? header * 1000 : null);
    }
    if (response.status === 403) throw new GooglePermissionError(message);
    if (response.status >= 500 && attempt < 2) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new GoogleApiError(response.status, reason, message);
  }
}

export type GscSiteEntry = { siteUrl: string; permissionLevel: string };

export async function listGscSites(config: GoogleConfig, accessToken: string): Promise<GscSiteEntry[]> {
  const body = await call<{ siteEntry?: GscSiteEntry[] }>(accessToken, `${config.webmastersUrl}/sites`, { method: "GET" });
  return body.siteEntry ?? [];
}

export type SearchAnalyticsRequest = {
  startDate: string;
  endDate: string;
  dimensions: ("date" | "query" | "page" | "country" | "device")[];
  type?: string;
  aggregationType?: "auto" | "byPage" | "byProperty";
  dataState?: "final" | "all";
  rowLimit?: number;
  startRow?: number;
};
export type SearchAnalyticsRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type SearchAnalyticsResponse = {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
  metadata?: { first_incomplete_date?: string };
};

export function querySearchAnalytics(config: GoogleConfig, accessToken: string, property: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsResponse> {
  return call<SearchAnalyticsResponse>(accessToken, `${config.webmastersUrl}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    body: request,
  });
}

export type IndexStatus = {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  crawledAs?: string;
};
export type InspectionResult = { inspectionResultLink?: string; indexStatusResult?: IndexStatus };

/** Reads Google's stored index record for a URL. This is not a live test of the page. */
export async function inspectUrl(config: GoogleConfig, accessToken: string, property: string, url: string): Promise<InspectionResult> {
  const body = await call<{ inspectionResult?: InspectionResult }>(accessToken, `${config.inspectionUrl}/urlInspection/index:inspect`, {
    method: "POST",
    body: { inspectionUrl: url, siteUrl: property, languageCode: "en-US" },
  });
  return body.inspectionResult ?? {};
}

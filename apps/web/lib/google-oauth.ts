import "server-only";
import { decryptSecret, encryptSecret } from "@scopekit/seo";
import { cookies } from "next/headers";
import { env } from "./env";

const COOKIE = "scopekit.google_oauth";
const PATH = "/api/integrations/google";
const TTL_SECONDS = 600;

export type OAuthAttempt = {
  state: string;
  codeVerifier: string;
  siteId: string;
  userId: string;
  /** Set when reconnecting an existing account instead of adding one. */
  integrationId: string | null;
  expiresAt: number;
};

/**
 * The state and PKCE verifier for one authorization attempt, encrypted into an HTTP-only
 * cookie scoped to the OAuth routes. The callback only proceeds for the same browser,
 * the same signed-in user and the same state value.
 */
export async function rememberAttempt(attempt: Omit<OAuthAttempt, "expiresAt">, masterKey: Buffer): Promise<void> {
  const payload: OAuthAttempt = { ...attempt, expiresAt: Date.now() + TTL_SECONDS * 1000 };
  (await cookies()).set(COOKIE, encryptSecret(JSON.stringify(payload), masterKey), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.secureCookies,
    path: PATH,
    maxAge: TTL_SECONDS,
  });
}

/** Reads and clears the attempt. Null when it is missing, expired or not ours. */
export async function takeAttempt(masterKey: Buffer): Promise<OAuthAttempt | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: PATH, maxAge: 0 });
  if (!raw) return null;
  try {
    const attempt = JSON.parse(decryptSecret(raw, masterKey)) as OAuthAttempt;
    return attempt.expiresAt > Date.now() ? attempt : null;
  } catch {
    return null;
  }
}

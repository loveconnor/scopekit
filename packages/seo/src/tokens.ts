import { saveIntegrationTokens, type Database, type Integration } from "@scopekit/db";
import { decryptSecret, encryptSecret } from "./crypto";
import { GoogleAuthError, refreshAccessToken, type GoogleConfig } from "./google";

export type GoogleAccess = { google: GoogleConfig; masterKey: Buffer };

/**
 * A usable access token for the account: the stored one while it is valid, otherwise a
 * refreshed one, saved encrypted. Throws GoogleAuthError when the owner has to reconnect.
 */
export async function getAccessToken(db: Database, integration: Integration, access: GoogleAccess, opts: { force?: boolean } = {}): Promise<string> {
  if (integration.connectionStatus !== "connected" || !integration.encryptedRefreshToken) {
    throw new GoogleAuthError("This Google account needs to be reconnected");
  }
  let refreshToken: string;
  try {
    if (!opts.force && integration.encryptedAccessToken && integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 60_000) {
      return decryptSecret(integration.encryptedAccessToken, access.masterKey);
    }
    refreshToken = decryptSecret(integration.encryptedRefreshToken, access.masterKey);
  } catch {
    throw new GoogleAuthError("Stored Google credentials cannot be decrypted with the current encryption key");
  }
  const tokens = await refreshAccessToken(access.google, refreshToken);
  await saveIntegrationTokens(db, integration.id, {
    encryptedAccessToken: encryptSecret(tokens.accessToken, access.masterKey),
    expiresAt: tokens.expiresAt,
  });
  return tokens.accessToken;
}

/**
 * Runs a Google call with the account's token. A 401 on a cached token gets one retry with a
 * fresh token before it counts as a lost grant.
 */
export async function withAccessToken<T>(db: Database, integration: Integration, access: GoogleAccess, work: (token: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken(db, integration, access);
  try {
    return await work(token);
  } catch (error) {
    if (!(error instanceof GoogleAuthError)) throw error;
    return work(await getAccessToken(db, integration, access, { force: true }));
  }
}

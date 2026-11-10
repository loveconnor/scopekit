import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "sk1";

/**
 * Reads the 32-byte master key from SCOPEKIT_ENCRYPTION_KEY (64 hex characters or base64).
 * Returns null when it is unset, so callers can report "not configured" instead of crashing.
 */
export function loadMasterKey(value = process.env.SCOPEKIT_ENCRYPTION_KEY): Buffer | null {
  if (!value) return null;
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("SCOPEKIT_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)");
  return key;
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/**
 * Envelope encryption: each secret gets its own random data key, and only that data key is
 * encrypted with the master key. Rotating the master key means re-wrapping small data keys,
 * and a leaked database row is useless without the key held in the environment.
 */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const dataKey = randomBytes(32);
  const wrapped = seal(masterKey, dataKey);
  const body = seal(dataKey, Buffer.from(plaintext, "utf8"));
  return `${VERSION}.${wrapped.toString("base64url")}.${body.toString("base64url")}`;
}

/** Throws when the value was tampered with or was encrypted under a different master key. */
export function decryptSecret(sealed: string, masterKey: Buffer): string {
  const [version, wrapped, body] = sealed.split(".");
  if (version !== VERSION || !wrapped || !body) throw new Error("Unrecognized secret format");
  const dataKey = open(masterKey, Buffer.from(wrapped, "base64url"));
  return open(dataKey, Buffer.from(body, "base64url")).toString("utf8");
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** PKCE S256 challenge for a code verifier. */
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

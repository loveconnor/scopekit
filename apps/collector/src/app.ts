/**
 * The collector as a Hono app, with no server attached: `src/index.ts` serves it with Node,
 * and `api/index.js` serves the bundled copy as a Vercel function.
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  classifySource,
  isExcludedPath,
  localDateOf,
  normalizePath,
  parseUserAgent,
  sanitizeProps,
  type ClassifiedSource,
} from "@scopekit/analytics";
import { COLLECT_LIMITS, collectEventSchema, INGEST_QUEUE, type CollectEvent, type QueuedEvent } from "@scopekit/contracts";
import { getDb, getVisitorSalt, insertEvents, loadCollectorSite, type CollectorSite } from "@scopekit/db";
import { Queue } from "bullmq";
import { Hono, type Context } from "hono";
import { Redis } from "ioredis";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const COUNTRY_HEADER = process.env.COLLECTOR_COUNTRY_HEADER?.toLowerCase() || null;
const TRUSTED_PROXIES = Number(process.env.COLLECTOR_TRUSTED_PROXIES ?? 0);
const RATE_PER_CLIENT = Number(process.env.COLLECTOR_RATE_PER_CLIENT ?? 120); // requests / minute / site + network
const RATE_PER_SITE = Number(process.env.COLLECTOR_RATE_PER_SITE ?? 6000); // requests / minute / site
const SESSION_TTL_SECONDS = 4 * 60 * 60;

const log = (level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, service: "collector", time: new Date().toISOString(), ...fields }));

const db = getDb();
/**
 * With REDIS_URL, events go through the BullMQ queue to the worker, and Redis holds rate
 * limits and session sources. Without it (the Vercel deployment), events are written straight
 * to Postgres, which is idempotent on event ID, and limits are kept per instance in memory.
 */
const REDIS_URL = process.env.REDIS_URL || null;
const redis = REDIS_URL ? new Redis(REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false }) : null;
redis?.on("error", (error) => log("error", "redis error", { error: error.message }));
const queue = redis ? new Queue(INGEST_QUEUE, { connection: redis }) : null;

// The Vercel build inlines the tracker; a Node server reads the built file from the SDK package.
declare const __SCOPEKIT_TRACKER__: string | undefined;
const trackerScript =
  typeof __SCOPEKIT_TRACKER__ === "string"
    ? __SCOPEKIT_TRACKER__
    : readFileSync(process.env.TRACKER_SCRIPT_PATH ?? createRequire(import.meta.url).resolve("@scopekit/sdk/script"), "utf8");

/* ------------------------------ small caches ------------------------------ */

const siteCache = new Map<string, { site: CollectorSite | null; expires: number }>();
async function siteFor(publicId: string): Promise<CollectorSite | null> {
  const hit = siteCache.get(publicId);
  if (hit && hit.expires > Date.now()) return hit.site;
  const site = await loadCollectorSite(db, publicId);
  if (siteCache.size > 5000) siteCache.clear();
  // Unknown IDs are cached too, so a flood of bad IDs cannot hammer the database.
  siteCache.set(publicId, { site, expires: Date.now() + 30_000 });
  return site;
}

const saltCache = new Map<string, string>();
async function saltFor(localDate: string): Promise<string> {
  let salt = saltCache.get(localDate);
  if (!salt) {
    salt = await getVisitorSalt(db, localDate);
    if (saltCache.size > 8) saltCache.clear();
    saltCache.set(localDate, salt);
  }
  return salt;
}

const rejections = new Map<string, number>();
const reject = (reason: string, count = 1) => rejections.set(reason, (rejections.get(reason) ?? 0) + count);
setInterval(() => {
  if (rejections.size === 0) return;
  log("info", "rejected events", { reasons: Object.fromEntries(rejections) });
  rejections.clear();
}, 60_000).unref();

/* -------------------------------- helpers --------------------------------- */

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function clientIp(c: Context): string {
  if (TRUSTED_PROXIES > 0) {
    const forwarded = (c.req.header("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    const candidate = forwarded[forwarded.length - TRUSTED_PROXIES];
    if (candidate) return candidate;
  }
  try {
    // Only a Node server has a socket address; on Vercel the client IP comes from x-forwarded-for.
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** The page's host, from Origin or Referer. Reduces accidental misuse; it does not authenticate a browser. */
function requestHost(c: Context): { host: string; hostname: string; origin: string } | null {
  const raw = c.req.header("origin") ?? c.req.header("referer");
  if (!raw || raw === "null") return null;
  try {
    const url = new URL(raw);
    return { host: url.host.toLowerCase(), hostname: url.hostname.toLowerCase(), origin: url.origin };
  } catch {
    return null;
  }
}

// Best effort without Redis: each function instance counts on its own.
const memoryCounts = new Map<string, number>();
const memorySessions = new Map<string, { source: ClassifiedSource; expires: number }>();

async function overLimit(siteId: string, ip: string): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const clientKey = `sk:rl:${siteId}:${sha(ip).slice(0, 16)}:${minute}`;
  const siteKey = `sk:rl:${siteId}:all:${minute}`;
  if (!redis) {
    const count = (key: string) => {
      const next = (memoryCounts.get(key) ?? 0) + 1;
      memoryCounts.set(key, next);
      return next;
    };
    if (memoryCounts.size > 20_000) memoryCounts.clear();
    return count(clientKey) > RATE_PER_CLIENT || count(siteKey) > RATE_PER_SITE;
  }
  const results = await redis.multi().incr(clientKey).expire(clientKey, 90).incr(siteKey).expire(siteKey, 90).exec();
  const perClient = Number(results?.[0]?.[1] ?? 0);
  const perSite = Number(results?.[2]?.[1] ?? 0);
  return perClient > RATE_PER_CLIENT || perSite > RATE_PER_SITE;
}

/**
 * A session keeps the source of its first event (first touch within the session), so
 * in-site navigations are not re-attributed to the site itself.
 */
async function sessionSource(sessionKey: string, first: ClassifiedSource): Promise<ClassifiedSource> {
  const key = `sk:sess:${sessionKey}`;
  if (!redis) {
    // Rollups take a session's source from its first event anyway; this only helps raw views.
    const hit = memorySessions.get(key);
    if (hit && hit.expires > Date.now()) return hit.source;
    if (memorySessions.size > 20_000) memorySessions.clear();
    memorySessions.set(key, { source: first, expires: Date.now() + SESSION_TTL_SECONDS * 1000 });
    return first;
  }
  try {
    const existing = await redis.get(key);
    if (existing) {
      void redis.expire(key, SESSION_TTL_SECONDS).catch(() => {});
      return JSON.parse(existing) as ClassifiedSource;
    }
    await redis.set(key, JSON.stringify(first), "EX", SESSION_TTL_SECONDS, "NX");
  } catch {
    // Without Redis the event keeps its own classification.
  }
  return first;
}

function cors(c: Context, origin: string | null) {
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
}

/* --------------------------------- routes --------------------------------- */

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/script.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(trackerScript);
});

app.options("/api/collect", (c) => {
  cors(c, c.req.header("origin") ?? null);
  c.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "content-type");
  c.header("Access-Control-Max-Age", "86400");
  return c.body(null, 204);
});

app.post("/api/collect", async (c) => {
  const page = requestHost(c);
  cors(c, page?.origin ?? null);
  const fail = (status: 400 | 403 | 404 | 413 | 429 | 503, code: string) => {
    reject(code);
    return c.json({ code }, status);
  };

  if (Number(c.req.header("content-length") ?? 0) > COLLECT_LIMITS.maxBodyBytes) return fail(413, "payload_too_large");
  const text = await c.req.text();
  if (Buffer.byteLength(text) > COLLECT_LIMITS.maxBodyBytes) return fail(413, "payload_too_large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(400, "invalid_json");
  }
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (candidates.length === 0 || candidates.length > COLLECT_LIMITS.maxBatch) return fail(400, "invalid_batch");

  const valid: CollectEvent[] = [];
  for (const candidate of candidates) {
    const result = collectEventSchema.safeParse(candidate);
    if (result.success) valid.push(result.data);
    else reject("invalid_event");
  }
  if (valid.length === 0) return c.json({ code: "invalid_event" }, 400);

  const publicId = valid[0]!.site;
  const site = await siteFor(publicId);
  if (!site) return fail(404, "unknown_site");
  if (!page || !(site.hostnames.includes(page.host) || site.hostnames.includes(page.hostname))) return fail(403, "origin_not_allowed");
  if (!site.trackingEnabled) return c.body(null, 204);

  const ip = clientIp(c);
  try {
    if (await overLimit(site.siteId, ip)) return fail(429, "rate_limited");
  } catch {
    return fail(503, "queue_unavailable");
  }

  const userAgent = c.req.header("user-agent") ?? "";
  const ua = parseUserAgent(userAgent);
  const country = COUNTRY_HEADER && site.geolocationEnabled ? c.req.header(COUNTRY_HEADER)?.toUpperCase() : undefined;
  const countryCode = country && /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null;
  const now = Date.now();
  const receivedAt = new Date(now).toISOString();

  const events: QueuedEvent[] = [];
  const ordered = valid
    .filter((event) => event.site === publicId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const event of ordered) {
    const occurred = Date.parse(event.occurredAt);
    if (occurred < now - COLLECT_LIMITS.maxPastSkewMs || occurred > now + COLLECT_LIMITS.maxFutureSkewMs) {
      reject("timestamp_out_of_range");
      continue;
    }
    if ((event.type === "custom") !== Boolean(event.name)) {
      reject("invalid_event");
      continue;
    }
    const normalizedPath = normalizePath(event.path, site.allowedQueryParams);
    if (isExcludedPath(normalizedPath, site.excludedPathPatterns)) {
      reject("excluded_path");
      continue;
    }

    const sessionKey = sha(`${site.siteId}|${event.sessionId}`).slice(0, 32);
    let visitorKey: string | null = null;
    if (site.privacyMode === "default") {
      // Site-specific, salted per day, truncated. The IP and user agent stop here.
      const salt = await saltFor(localDateOf(new Date(occurred), site.timezone));
      visitorKey = createHmac("sha256", salt).update(`${site.siteId}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
    } else if (site.privacyMode === "consent" && event.visitorId) {
      visitorKey = sha(`${site.siteId}|${event.visitorId}`).slice(0, 32);
    }

    const source = await sessionSource(
      sessionKey,
      classifySource({ referrer: event.referrer, utm: event.utm, ownHostnames: site.hostnames }),
    );
    const { props } = sanitizeProps(event.props);

    events.push({
      id: event.id,
      siteId: site.siteId,
      eventType: event.type,
      eventName: event.type === "custom" ? event.name! : null,
      occurredAt: event.occurredAt,
      receivedAt,
      normalizedPath,
      sessionKey,
      visitorKey,
      referrerDomain: source.referrerDomain,
      source: source.source,
      medium: source.medium,
      campaign: source.campaign,
      countryCode,
      deviceType: ua.deviceType,
      browserFamily: ua.browserFamily,
      props: event.type === "engagement" || event.type === "pageview" ? {} : props,
      engagedMs: event.type === "engagement" ? (event.engagedMs ?? 0) : null,
      botFlag: ua.isBot,
    });
  }

  if (events.length > 0) {
    try {
      if (queue) await queue.add("events", { events }, { attempts: 8, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 500, removeOnFail: 5000 });
      else await insertEvents(db, events);
    } catch (error) {
      log("error", queue ? "enqueue failed" : "insert failed", { error: (error as Error).message });
      return fail(503, "queue_unavailable");
    }
  }
  return c.json({ accepted: events.length, rejected: candidates.length - events.length }, 202);
});

app.notFound((c) => c.json({ code: "not_found" }, 404));
app.onError((error, c) => {
  log("error", "unhandled", { error: error.message });
  return c.json({ code: "internal_error" }, 500);
});

export { queue, redis };
export default app;

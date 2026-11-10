/**
 * End-to-end tracking check (spec 20.1). Needs Postgres, Redis, the collector and the
 * worker running, plus a Chromium binary:
 *
 *   CHROME_PATH=/path/to/chromium npm run test:e2e
 *
 * It serves a small fixture site, drives it in a real browser, and asserts on what reached
 * the database: one pageview per real navigation, no double counts, no PII, consent gating.
 */
import { createSite, closeDb, getDb, insertEvents, runAggregation, schema } from "@scopekit/db";
import { eq, sql } from "drizzle-orm";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

const COLLECTOR = process.env.NEXT_PUBLIC_COLLECTOR_URL ?? "http://localhost:8787";
const PORT = 4173;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const db = getDb();

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const page = (siteId: string, extra = "") => `<!doctype html><html><head><title>Fixture</title>
<script defer src="${COLLECTOR}/script.js" data-site="${siteId}" ${extra}></script></head>
<body><h1>Fixture</h1><input id="secret" value="do-not-capture" /></body></html>`;

async function eventsFor(siteId: string) {
  const result = await db.execute(sql`
    select event_type, event_name, normalized_path, props, visitor_key is not null as has_visitor, source, medium
    from analytics_events where site_id = ${siteId} and event_type <> 'engagement' order by occurred_at, event_type`);
  return Array.from(result as unknown as Record<string, unknown>[]);
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 2500));

const sites: string[] = [];
let current = "";
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(current);
}).listen(PORT);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  /* ---- default mode: navigation counting ---- */
  const site = await createSite(db, { name: "E2E default", origin: `http://localhost:${PORT}`, hostname: `localhost:${PORT}`, timezone: "UTC", privacyMode: "default" });
  sites.push(site.id);
  current = page(site.publicTrackingId);
  const context = await browser.newContext({ userAgent: UA });
  const tab = await context.newPage();
  const pageErrors: string[] = [];
  tab.on("pageerror", (error) => pageErrors.push(error.message));

  await tab.goto(`http://localhost:${PORT}/?utm_source=newsletter&utm_medium=email&token=abc`);
  await tab.waitForFunction(() => Boolean((window as unknown as { scopekit?: { loaded: boolean } }).scopekit?.loaded));
  await tab.waitForTimeout(900);
  await tab.evaluate(() => history.pushState({}, "", "/docs")); // client-side navigation
  await tab.waitForTimeout(900);
  await tab.evaluate(() => history.replaceState({}, "", "/docs")); // same URL: no pageview
  await tab.waitForTimeout(900);
  await tab.goBack(); // popstate back to "/": a new pageview
  await tab.waitForTimeout(900);
  await tab.evaluate(() =>
    (window as unknown as { scopekit: { track: (n: string, p: object) => void } }).scopekit.track("signup_completed", {
      plan: "free",
      email: "person@example.com",
      token: "secret",
    }),
  );
  await tab.waitForTimeout(900);
  await tab.close(); // pagehide flush
  await settle();

  const rows = await eventsFor(site.id);
  check("pageviews: load, pushState, back (replaceState to same URL ignored)", rows.filter((r) => r.event_type === "pageview").map((r) => r.normalized_path), ["/", "/docs", "/"]);
  const custom = rows.find((r) => r.event_type === "custom");
  check("custom event stored once", rows.filter((r) => r.event_type === "custom").length, 1);
  check("PII-looking properties dropped", custom?.props, { plan: "free" });
  check("session keeps its first-touch campaign source", [...new Set(rows.map((r) => `${r.source}/${r.medium}`))], ["newsletter/email"]);
  check("query string and tokens never stored in the path", rows.some((r) => String(r.normalized_path).includes("?")), false);
  check("daily visitor estimate key present in default mode", rows.every((r) => r.has_visitor), true);
  check("tracker threw nothing into the host page", pageErrors, []);

  /* ---- duplicate delivery ---- */
  const [stored] = Array.from((await db.execute(sql`select id from analytics_events where site_id = ${site.id} limit 1`)) as unknown as { id: string }[]);
  const before = rows.length;
  const duplicate = await insertEvents(db, [
    { id: stored!.id, siteId: site.id, eventType: "pageview", eventName: null, occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), normalizedPath: "/", sessionKey: "dup", visitorKey: null, referrerDomain: null, source: "(direct)", medium: "(none)", campaign: null, countryCode: null, deviceType: "desktop", browserFamily: "Chrome", props: {}, engagedMs: null, botFlag: false },
  ]);
  check("repeated event ID is not inserted", duplicate, 0);
  check("event count unchanged after duplicate", (await eventsFor(site.id)).length, before);

  await runAggregation(db);
  const [daily] = await db.select().from(schema.siteDailyMetrics).where(eq(schema.siteDailyMetrics.siteId, site.id));
  check("rollup: pageviews / sessions / events", [daily?.pageviews, daily?.sessions, daily?.eventCount], [3, 1, 1]);
  await runAggregation(db);
  const [again] = await db.select().from(schema.siteDailyMetrics).where(eq(schema.siteDailyMetrics.siteId, site.id));
  check("rollup is idempotent", [again?.pageviews, again?.sessions], [3, 1]);

  /* ---- rejections ---- */
  const post = (body: unknown, origin: string) =>
    fetch(`${COLLECTOR}/api/collect`, { method: "POST", headers: { origin, "user-agent": UA, "content-type": "text/plain" }, body: typeof body === "string" ? body : JSON.stringify(body) }).then((r) => r.status);
  const event = { v: 1, site: site.publicTrackingId, id: crypto.randomUUID(), type: "pageview", occurredAt: new Date().toISOString(), path: "/x", sessionId: "abcdefgh1234" };
  check("unapproved origin rejected", await post(event, "https://evil.example"), 403);
  check("unknown site rejected", await post({ ...event, site: "sk_site_AAAAAAAAAAAAAAAA" }, `http://localhost:${PORT}`), 404);
  check("oversized payload rejected", await post("x".repeat(11_000), `http://localhost:${PORT}`), 413);
  check("invalid event rejected", await post({ ...event, type: "keystroke" }, `http://localhost:${PORT}`), 400);
  check("backdated event dropped", await post({ ...event, occurredAt: "2020-01-01T00:00:00.000Z" }, `http://localhost:${PORT}`).then(async (status) => {
    await settle();
    return [status, (await eventsFor(site.id)).some((r) => r.normalized_path === "/x")];
  }), [202, false]);

  /* ---- consent mode: nothing before consent ---- */
  await db.delete(schema.siteDomains).where(eq(schema.siteDomains.siteId, site.id)); // free the hostname
  const consent = await createSite(db, { name: "E2E consent", origin: `http://localhost:${PORT}`, hostname: `localhost:${PORT}`, timezone: "UTC", privacyMode: "consent" });
  sites.push(consent.id);
  current = page(consent.publicTrackingId, 'data-mode="consent"');
  const consentContext = await browser.newContext({ userAgent: UA });
  const consentTab = await consentContext.newPage();
  const sent: string[] = [];
  consentTab.on("request", (request) => request.url().includes("/api/collect") && sent.push(request.url()));
  await consentTab.goto(`http://localhost:${PORT}/`);
  await consentTab.waitForFunction(() => Boolean((window as unknown as { scopekit?: { loaded: boolean } }).scopekit?.loaded));
  await consentTab.waitForTimeout(1500);
  check("consent mode: no request before consent", sent.length, 0);
  check("consent mode: no identifier stored before consent", (await consentContext.cookies()).length, 0);
  await consentTab.evaluate(() => (window as unknown as { scopekit: { enable: () => void } }).scopekit.enable());
  await consentTab.waitForTimeout(1500);
  check("consent mode: pageview sent after enable()", sent.length > 0, true);
  check("consent mode: first-party visitor cookie set after enable()", (await consentContext.cookies()).map((c) => c.name), ["sk_v"]);
  await consentTab.close();
  await settle();
  check("consent mode: pageview stored with a visitor key", (await eventsFor(consent.id)).map((r) => [r.event_type, r.has_visitor]), [["pageview", true]]);
} finally {
  await browser.close();
  server.close();
  for (const id of sites) await db.delete(schema.sites).where(eq(schema.sites.id, id));
  await closeDb();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll tracking checks passed");
process.exit(failures ? 1 : 0);

/**
 * Search Console sync against a stand-in Google server and the real database.
 *
 *   npm run test:gsc
 *
 * It checks that stored totals equal what the property reports at the same property and
 * date aggregation, that reruns and revisions never double count, and that rate limits and
 * a revoked grant are handled without losing history.
 */
import { addDays } from "@scopekit/analytics";
import {
  claimDueProperties,
  closeDb,
  countOpportunities,
  createIntegration,
  createSite,
  getDb,
  getIntegration,
  getProperty,
  gscNamedQueryTotals,
  gscPairs,
  gscQueryTable,
  gscSegments,
  gscSubjectTotals,
  gscTotals,
  linkProperty,
  listGscSyncRuns,
  listOpportunities,
  requestPropertySync,
  rows,
  schema,
  updateProperty,
} from "@scopekit/db";
import { backfillProgress, ctrOf, encryptSecret, googleConfigFromEnv, positionOf, syncProperty } from "@scopekit/seo";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { MOCK_QUERIES, startMockGoogle } from "./mock-google";

const PROPERTY = "sc-domain:gsc-e2e.test";
const HISTORY = 70;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
};
const close = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-6;

const db = getDb();
const mock = await startMockGoogle({ historyDays: HISTORY, properties: [{ siteUrl: PROPERTY, permissionLevel: "siteOwner" }] });
const masterKey = randomBytes(32);
const google = googleConfigFromEnv({ GOOGLE_CLIENT_ID: "mock-client", GOOGLE_CLIENT_SECRET: "mock-secret", SCOPEKIT_GOOGLE_BASE_URL: mock.url })!;
const options = { google, masterKey, requestDelayMs: 0 };

await db.delete(schema.sites).where(eq(schema.sites.name, "GSC e2e"));
const { id: siteId } = await createSite(db, { name: "GSC e2e", origin: "https://gsc-e2e.test", hostname: "gsc-e2e.test", timezone: "UTC", privacyMode: "default" });
const integrationId = await createIntegration(db, {
  ownerUserId: null,
  accountLabel: "Mock account",
  encryptedAccessToken: null,
  encryptedRefreshToken: encryptSecret("mock-refresh-token", masterKey),
  scope: "https://www.googleapis.com/auth/webmasters.readonly",
  expiresAt: null,
  isDemo: false,
});
const finalized = mock.finalizedThrough();
const target = addDays(finalized, -(HISTORY + 20));
const propertyId = await linkProperty(db, {
  siteId,
  integrationId,
  externalPropertyId: PROPERTY,
  externalPropertyType: "domain",
  permissionLevel: "siteOwner",
  backfillTarget: target,
});

try {
  const stored = (await getIntegration(db, integrationId))!;
  check("refresh token is not stored in plain text", !stored.encryptedRefreshToken!.includes("mock-refresh-token"));

  const due = await claimDueProperties(db);
  check("a newly linked property is due for sync", due.includes(propertyId));
  check("a property that is syncing is not handed out twice", !(await claimDueProperties(db)).includes(propertyId));

  // First run with no time budget: recent days only, history left for later.
  const first = await syncProperty(db, propertyId, { ...options, maxRunMs: 0 });
  check("first run stops at its time budget and reports partial", first.status === "partial", first.status);
  check("finalized date comes from Google, not a fixed lag", first.finalizedThrough === finalized, `${first.finalizedThrough} vs ${finalized}`);
  let property = (await getProperty(db, propertyId))!;
  const early = backfillProgress(property)!;
  check("backfill progress is reported while history is incomplete", early.done === 7 && early.total === HISTORY + 21 && !early.complete, JSON.stringify(early));
  check("an unfinished backfill is due again immediately", (await claimDueProperties(db)).includes(propertyId));

  // Property totals for the whole history are available after the first run.
  const expected = mock.expectedTotals(PROPERTY, target, finalized);
  let totals = await gscTotals(db, propertyId, target, finalized);
  check("clicks equal the property total", totals.clicks === expected.clicks, `${totals.clicks} vs ${expected.clicks}`);
  check("impressions equal the property total", totals.impressions === expected.impressions, `${totals.impressions} vs ${expected.impressions}`);
  check("CTR is total clicks over total impressions", close(ctrOf(totals), expected.ctr));
  check("average position is impression-weighted", close(positionOf(totals), expected.position), `${positionOf(totals)} vs ${expected.position}`);
  check("days before the property existed are absent, not zero", totals.days === HISTORY - 2, String(totals.days));

  // A 500 in the middle of the backfill is retried inside the client.
  mock.state.failNext = true;
  const second = await syncProperty(db, propertyId, options);
  check("backfill completes and survives a transient 500", second.status === "done", `${second.status} ${second.error ?? ""}`);
  property = (await getProperty(db, propertyId))!;
  check("backfill reaches its target", backfillProgress(property)!.complete && property.oldestSyncedDate === target);
  check("a finished property waits for the next daily sync", property.nextSyncAt !== null && property.nextSyncAt.getTime() > Date.now() + 23 * 3_600_000);

  const week = { from: addDays(finalized, -6), to: finalized };
  const expectedWeek = mock.expectedTotals(PROPERTY, week.from, week.to);
  const named = await gscNamedQueryTotals(db, propertyId, week.from, week.to);
  check("named queries add up to less than the total (anonymized gap kept)", named.clicks === expectedWeek.namedClicks && named.clicks < expectedWeek.clicks, `${named.clicks} of ${expectedWeek.clicks}`);
  check("every visible query is stored", named.queries === MOCK_QUERIES.length, String(named.queries));

  const table = await gscQueryTable(db, { propertyId, from: week.from, to: week.to, previous: { from: addDays(week.from, -7), to: addDays(week.from, -1) }, sort: "clicks", limit: 50, offset: 0 });
  const top = table.rows[0]!;
  const own = await gscSubjectTotals(db, "query", propertyId, top.key, week.from, week.to);
  check("query table rows match the query's own totals and carry a comparison", top.clicks === own.clicks && top.previous !== null && table.total === MOCK_QUERIES.length);
  const pairs = await gscPairs(db, "query", propertyId, "gps rover setup", week.from, week.to);
  check("a query lists the page it leads to", pairs.length === 1 && pairs[0]!.key === "https://gsc-e2e.test/guides/gps-rover", JSON.stringify(pairs));
  const devices = await gscSegments(db, propertyId, week.from, week.to, "device");
  const countries = await gscSegments(db, propertyId, week.from, week.to, "country");
  const sum = (items: { clicks: number }[]) => items.reduce((n, r) => n + r.clicks, 0);
  check("device and country splits each add up to the property total", sum(devices) === expectedWeek.clicks && sum(countries) === expectedWeek.clicks, `${sum(devices)} ${sum(countries)} ${expectedWeek.clicks}`);

  // Rerun: nothing may change.
  const count = async () => (await rows<{ n: number }>(db, sql`select (select count(*) from gsc_query_daily where property_id = ${propertyId}) + (select count(*) from gsc_page_daily where property_id = ${propertyId}) + (select count(*) from gsc_site_daily where property_id = ${propertyId}) as n`))[0]!.n;
  const before = await count();
  await requestPropertySync(db, propertyId);
  const again = await syncProperty(db, propertyId, options);
  totals = await gscTotals(db, propertyId, target, finalized);
  check("a repeated sync adds no rows and changes no totals", again.status === "done" && Number(await count()) === Number(before) && totals.clicks === expected.clicks);

  // Google revises a recent day: the stored day is replaced, not added to.
  const revised = addDays(finalized, -2);
  mock.state.revisions.set(revised, 1.5);
  await syncProperty(db, propertyId, options);
  const afterRevision = mock.expectedTotals(PROPERTY, target, finalized);
  totals = await gscTotals(db, propertyId, target, finalized);
  check("a late revision inside the trailing week replaces the stored day", totals.clicks === afterRevision.clicks && afterRevision.clicks !== expected.clicks, `${totals.clicks} vs ${afterRevision.clicks}`);

  // Opportunities from the rules.
  const found = await listOpportunities(db, propertyId);
  const has = (rule: string, subject: string) => found.some((o) => o.rule === rule && o.subject === subject);
  check("low CTR is flagged against the site's own queries at that position", has("low_ctr", "total station price"), found.map((o) => `${o.rule}:${o.subject}`).join(", "));
  check("a comparable query with a normal CTR is not flagged", !has("low_ctr", "field notebook"));
  check("a steady query just off page one is flagged with its page", has("near_page_one", "gps rover setup"));
  check("a page that lost clicks against the previous 28 days is flagged", has("declining_clicks", "https://gsc-e2e.test/old-guide"));
  check("scores stay between 0 and 100", found.every((o) => o.score >= 0 && o.score <= 100));
  await db.update(schema.seoOpportunities).set({ status: "dismissed" }).where(eq(schema.seoOpportunities.subject, "total station price"));
  await syncProperty(db, propertyId, options);
  check("a dismissed opportunity stays dismissed after the next sync", (await countOpportunities(db, propertyId)).dismissed === 1);

  // Rate limit in the middle of a fresh backfill.
  await db.execute(sql`delete from gsc_query_daily where property_id = ${propertyId}`);
  await db.execute(sql`delete from gsc_page_daily where property_id = ${propertyId}`);
  await db.execute(sql`delete from gsc_site_daily where property_id = ${propertyId}`);
  await updateProperty(db, propertyId, { oldestSyncedDate: null, finalizedThrough: null });
  mock.state.rateLimitAfter = 40;
  mock.state.rateLimitFor = 1;
  const limited = await syncProperty(db, propertyId, options);
  property = (await getProperty(db, propertyId))!;
  check("a 429 stops the run and is recorded as rate limited", limited.status === "rate_limited" && property.syncStatus === "rate_limited");
  check("the retry is scheduled from Google's Retry-After", property.nextSyncAt !== null && property.nextSyncAt.getTime() > Date.now() && property.nextSyncAt.getTime() < Date.now() + 10_000);
  check("progress made before the 429 is kept as a checkpoint", property.oldestSyncedDate !== null && property.oldestSyncedDate > target);
  check("a rate-limited property is not retried early", !(await claimDueProperties(db)).includes(propertyId));
  const resumed = await syncProperty(db, propertyId, options);
  totals = await gscTotals(db, propertyId, target, finalized);
  const namedAll = await gscNamedQueryTotals(db, propertyId, target, finalized);
  check("the sync resumes after the limit and ends with exact totals", resumed.status === "done" && totals.clicks === afterRevision.clicks && namedAll.clicks === afterRevision.namedClicks, `${resumed.status} ${totals.clicks} ${namedAll.clicks}`);
  const runs = await listGscSyncRuns(db, siteId, 20);
  check("the rate-limited run is on record", runs.some((r) => r.status === "rate_limited" && r.quotaLimited));

  // The owner removes access in their Google account.
  mock.state.revoked = true;
  await db.update(schema.integrations).set({ expiresAt: new Date(0) }).where(eq(schema.integrations.id, integrationId));
  const revoked = await syncProperty(db, propertyId, options);
  const integration = (await getIntegration(db, integrationId))!;
  totals = await gscTotals(db, propertyId, target, finalized);
  check("a revoked grant marks the connection as needing reconnection", revoked.status === "needs_reauth" && integration.connectionStatus === "needs_reauth");
  check("history synced before the revocation is preserved", totals.clicks === afterRevision.clicks);
  await requestPropertySync(db, propertyId);
  check("a connection that needs reconnecting is not synced again", !(await claimDueProperties(db)).includes(propertyId));
  check("no token appears in a stored error", !JSON.stringify([integration.lastError, runs.map((r) => r.error)]).includes("mock-"));
} finally {
  await db.delete(schema.sites).where(eq(schema.sites.id, siteId));
  await db.delete(schema.integrations).where(eq(schema.integrations.id, integrationId));
  await mock.close();
  await closeDb();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll Search Console checks passed");
process.exit(failures ? 1 : 0);

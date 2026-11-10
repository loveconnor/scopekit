/**
 * Performance runs, field data and alerts against a stand-in provider and the real database.
 *
 *   npm run test:health
 */
import { addDays, localDateOf } from "@scopekit/analytics";
import { GSC_TIMEZONE } from "@scopekit/contracts";
import {
  claimQueuedPerformanceRuns,
  closeDb,
  createIntegration,
  createSite,
  cruxSeries,
  getDb,
  getSite,
  latestPerformance,
  linkProperty,
  listAlerts,
  performanceHistory,
  queuePerformanceRun,
  replaceGscSiteDaily,
  saveAlertRule,
  scheduleDuePerformanceRuns,
  schema,
  setAlertStatus,
  updateProperty,
} from "@scopekit/db";
import { evaluateAlerts, performanceConfigFromEnv, runPerformanceRun, syncCrux } from "@scopekit/health";
import { eq, sql } from "drizzle-orm";
import { startMockGoogle } from "./mock-google";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
  if (!ok) failures++;
};

const db = getDb();
const mock = await startMockGoogle();
const config = performanceConfigFromEnv({ GOOGLE_API_KEY: "mock-key", SCOPEKIT_GOOGLE_BASE_URL: mock.url })!;
await db.delete(schema.sites).where(eq(schema.sites.name, "Health e2e"));
const { id: siteId } = await createSite(db, { name: "Health e2e", origin: "https://health-e2e.test", hostname: "health-e2e.test", timezone: "UTC", privacyMode: "default" });
const home = "https://health-e2e.test/";
const lab = async (device: "mobile" | "desktop" = "mobile", trigger: "manual" | "scheduled" = "manual") => {
  const id = await queuePerformanceRun(db, { siteId, url: home, device, trigger });
  await claimQueuedPerformanceRuns(db);
  return { id, status: id ? await runPerformanceRun(db, id, config) : "skipped" };
};
const open = async (type?: string) => (await listAlerts(db, { siteIds: [siteId], statuses: ["open"] })).filter((a) => !type || a.type === type);

try {
  /* Lab runs */
  check("performance is not configured without an API key", performanceConfigFromEnv({}) === null);
  const first = await lab();
  const latest = (await latestPerformance(db, siteId, home)).mobile!;
  check("a lab run stores scores as the provider returned them", first.status === "done" && latest.scores?.performance === 92 && latest.scores.accessibility === 96 && latest.lighthouseVersion === "12.6.0", JSON.stringify(latest.scores));
  check("lab metrics are stored in milliseconds", latest.metrics?.lcp === 2480 && latest.metrics.cls === 0.02, JSON.stringify(latest.metrics));
  check("only recommendations with a returned saving are listed", latest.opportunities?.length === 2 && latest.opportunities[0]!.id === "unused-javascript" && latest.opportunities[0]!.savingsMs === 450, JSON.stringify(latest.opportunities));
  const [raw] = await db.select({ raw: schema.performanceRuns.raw }).from(schema.performanceRuns).where(eq(schema.performanceRuns.id, first.id!));
  check("the provider payload is kept without screenshots", !!raw?.raw && !JSON.stringify(raw.raw).includes("base64"));
  const waiting = await queuePerformanceRun(db, { siteId, url: home, device: "desktop", trigger: "manual" });
  check("the same page and device cannot be queued twice", waiting !== null && (await queuePerformanceRun(db, { siteId, url: home, device: "desktop", trigger: "manual" })) === null);
  await claimQueuedPerformanceRuns(db);
  await runPerformanceRun(db, waiting!, config);

  mock.state.rateLimitAfter = 0;
  mock.state.rateLimitFor = 1;
  const limited = await lab();
  const history = await performanceHistory(db, siteId, home, "mobile");
  check("a provider rate limit fails that run with a reason and keeps earlier results", limited.status === "error" && history[0]!.status === "error" && /quota/i.test(history[0]!.error ?? "") && history[1]!.status === "done");
  mock.state.rateLimitAfter = null;
  check("scheduled runs are not queued again within the day", (await scheduleDuePerformanceRuns(db)) === 0);

  /* Lighthouse regression: one low run is not enough */
  await db.execute(sql`delete from performance_runs where site_id = ${siteId} and status = 'error'`);
  mock.state.psiScore = 0.7;
  await lab();
  check("one low run does not raise an alert", (await evaluateAlerts(db)).raised.length === 0 && (await open()).length === 0);
  await lab();
  const regression = await evaluateAlerts(db);
  check("two consecutive low runs raise one regression alert", regression.raised.length === 1 && regression.raised[0]!.type === "lighthouse_regression", regression.raised.map((a) => a.type).join(","));
  check("evaluating again does not duplicate it", (await evaluateAlerts(db)).raised.length === 0 && (await open("lighthouse_regression")).length === 1);
  await lab();
  check("a further low run inside the cooldown raises nothing new", (await evaluateAlerts(db)).raised.length === 0 && (await open("lighthouse_regression")).length === 1);
  mock.state.lighthouseVersion = "13.0.0";
  mock.state.psiScore = 0.5;
  await db.execute(sql`delete from alerts where site_id = ${siteId}`);
  await lab();
  check("a drop across a Lighthouse major version is not compared", (await evaluateAlerts(db)).raised.length === 0);

  /* Field data */
  mock.state.cruxNoData = true;
  await syncCrux(db, { siteId, origin: "https://health-e2e.test" }, config);
  let site = (await getSite(db, siteId, { includeDemo: false }))!;
  check("an origin without field data is recorded as having none, with no rows", site.settings.cruxStatus?.PHONE === "no_data" && (await cruxSeries(db, siteId, "PHONE")).length === 0);
  mock.state.cruxNoData = false;
  await syncCrux(db, { siteId, origin: "https://health-e2e.test" }, config);
  await syncCrux(db, { siteId, origin: "https://health-e2e.test" }, config);
  const series = await cruxSeries(db, siteId, "PHONE");
  site = (await getSite(db, siteId, { includeDemo: false }))!;
  check("field history is imported once per collection period", series.length === 12 && series.at(-1)!.lcpP75 === 2100 && series.at(-1)!.clsP75 === 0.05 && site.settings.cruxStatus?.PHONE === "ok", String(series.length));
  check("field data within the same band raises nothing", (await evaluateAlerts(db)).raised.length === 0);
  mock.state.cruxLatestLcp = 4300;
  await syncCrux(db, { siteId, origin: "https://health-e2e.test" }, config);
  const cwv = await evaluateAlerts(db);
  check("field LCP moving from good to poor raises a critical alert", cwv.raised.length === 1 && cwv.raised[0]!.type === "cwv_deterioration" && cwv.raised[0]!.severity === "critical" && cwv.raised[0]!.entity === "lcp");

  /* Tracking stopped */
  await db.execute(sql`delete from alerts where site_id = ${siteId}`);
  const now = new Date();
  const lastEvent = new Date(now.getTime() - 30 * 3_600_000);
  await db.update(schema.sites).set({ firstEventAt: lastEvent, lastEventAt: lastEvent, status: "active" }).where(eq(schema.sites.id, siteId));
  check("a site with no traffic history is not reported as stopped", !(await evaluateAlerts(db)).raised.some((a) => a.type === "tracking_stopped"));
  const lastDate = localDateOf(lastEvent, "UTC");
  await db.insert(schema.siteDailyMetrics).values([0, 1, 2, 3].map((d) => ({ siteId, localDate: addDays(lastDate, -d), visitorMode: "estimated-daily-unique" as const, pageviews: 40, sessions: 20 })));
  const stopped = await evaluateAlerts(db);
  check("a site that had traffic and went silent for a day raises a critical alert", stopped.raised.filter((a) => a.type === "tracking_stopped").length === 1 && stopped.raised.find((a) => a.type === "tracking_stopped")!.severity === "critical");
  const alertId = (await open("tracking_stopped"))[0]!.id;
  await setAlertStatus(db, alertId, [siteId], { status: "acknowledged" });
  check("an acknowledged alert is not raised again", (await evaluateAlerts(db)).raised.length === 0);
  await db.update(schema.sites).set({ lastEventAt: now }).where(eq(schema.sites.id, siteId));
  const resumed = await evaluateAlerts(db);
  const history2 = await listAlerts(db, { siteIds: [siteId] });
  check("the alert resolves itself when events resume and stays in the history", resumed.resolved === 1 && history2.find((a) => a.id === alertId)?.status === "resolved" && history2.find((a) => a.id === alertId)?.resolvedAt !== null);
  await db.update(schema.sites).set({ lastEventAt: lastEvent }).where(eq(schema.sites.id, siteId));
  await saveAlertRule(db, siteId, "tracking_stopped", { enabled: false });
  check("a rule switched off for the site raises nothing", !(await evaluateAlerts(db)).raised.some((a) => a.type === "tracking_stopped"));

  /* Search Console: drop over finalized weeks, and lost access */
  const integrationId = await createIntegration(db, { ownerUserId: null, accountLabel: "Mock", encryptedAccessToken: null, encryptedRefreshToken: "x", scope: null, expiresAt: null, isDemo: false });
  const finalized = addDays(localDateOf(now, GSC_TIMEZONE), -3);
  const propertyId = await linkProperty(db, { siteId, integrationId, externalPropertyId: "sc-domain:health-e2e.test", externalPropertyType: "domain", permissionLevel: "siteOwner", backfillTarget: addDays(finalized, -13), schedule: false });
  await updateProperty(db, propertyId, { finalizedThrough: finalized, oldestSyncedDate: addDays(finalized, -13) });
  const days = (clicksNow: number) => Array.from({ length: 14 }, (_, i) => ({ date: addDays(finalized, -i), clicks: i < 7 ? clicksNow : 20, impressions: 400, positionNumerator: 2000 }));
  await replaceGscSiteDaily(db, { propertyId, siteId, from: addDays(finalized, -13), to: finalized }, days(18));
  check("a small search dip raises nothing", !(await evaluateAlerts(db)).raised.some((a) => a.type === "search_click_drop"));
  await replaceGscSiteDaily(db, { propertyId, siteId, from: addDays(finalized, -13), to: finalized }, days(8));
  const drop = await evaluateAlerts(db);
  check("clicks down 60% and 84 over finalized weeks raise a warning", drop.raised.filter((a) => a.type === "search_click_drop").length === 1 && drop.raised[0]!.evidence.previousClicks === 140, JSON.stringify(drop.raised.map((a) => a.evidence)));
  await updateProperty(db, propertyId, { finalizedThrough: addDays(finalized, 1) });
  await replaceGscSiteDaily(db, { propertyId, siteId, from: addDays(finalized, 1), to: addDays(finalized, 1) }, [{ date: addDays(finalized, 1), clicks: 8, impressions: 400, positionNumerator: 2000 }]);
  check("the next day's window stays quiet during the cooldown", !(await evaluateAlerts(db)).raised.some((a) => a.type === "search_click_drop"));
  await db.update(schema.integrations).set({ connectionStatus: "needs_reauth" }).where(eq(schema.integrations.id, integrationId));
  const lost = await evaluateAlerts(db);
  check("lost Google access raises one alert", lost.raised.filter((a) => a.type === "integration_disconnected").length === 1 && (await evaluateAlerts(db)).raised.length === 0);
  await db.update(schema.integrations).set({ connectionStatus: "connected" }).where(eq(schema.integrations.id, integrationId));
  check("it resolves itself after reconnecting", (await evaluateAlerts(db)).resolved === 1 && (await open("integration_disconnected")).length === 0);
  await db.delete(schema.integrations).where(eq(schema.integrations.id, integrationId));
} finally {
  await db.delete(schema.sites).where(eq(schema.sites.id, siteId));
  await mock.close();
  await closeDb();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll performance and alert checks passed");
process.exit(failures ? 1 : 0);

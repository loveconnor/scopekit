/**
 * Synthetic demo sites for designing and reviewing the dashboard.
 *
 *   npm run demo:seed    create (or recreate) the demo sites
 *   npm run demo:clear   remove them
 *
 * Every record a demo site holds (traffic, search, audit, performance, alerts) is synthetic.
 * Demo sites are flagged `is_demo`, use reserved `.example` hostnames, are never accepted by
 * the collector, and only appear in the app when SCOPEKIT_DEMO=1. The generator is seeded,
 * so every run produces the same shapes. Events go through the real insert and rollup code.
 */
import { addDays, localDateOf, startOfLocalDay } from "@scopekit/analytics";
import { auditScore, RULE_BY_ID } from "@scopekit/audit";
import { GSC_TIMEZONE, type CrawlSummary, type DeviceType, type GoalRules, type QueuedEvent } from "@scopekit/contracts";
import {
  applyFindings,
  closeDb,
  createAnnotation,
  createIntegration,
  openIssueCounts,
  openIssuesByRule,
  raiseAlert,
  saveCrawlPages,
  setCruxStatus,
  upsertCruxHistory,
  createSite,
  getDb,
  insertEvents,
  linkProperty,
  replaceGscDetail,
  replaceGscSegments,
  replaceGscSiteDaily,
  runAggregation,
  schema,
  updateProperty,
  type GscDetailRows,
} from "@scopekit/db";
import { refreshOpportunities } from "@scopekit/seo";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

const DAYS = 75;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1]![0];
}

const uuidFrom = (text: string) => {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const key = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 32);

type Source = { source: string; medium: string; referrerDomain: string | null; campaign: string | null };
/** A search term for the synthetic Search Console property: daily impressions, average position and CTR. */
type DemoQuery = readonly [query: string, page: string, impressions: number, position: number, ctr: number];
type DemoSite = {
  name: string;
  /** Null leaves the site without Search Console, to show the not-connected state. */
  search: readonly DemoQuery[] | null;
  hostname: string;
  timezone: string;
  seed: number;
  sessionsPerDay: number;
  /** Multiplier reached at the end of the window; below 1 means a decline. */
  trend: number;
  pages: readonly (readonly [string, number])[];
  sources: readonly (readonly [Source, number])[];
  events: readonly { name: string; rate: number; props?: () => Record<string, string> }[];
  goals: readonly { name: string; rules: GoalRules }[];
};

const src = (source: string, medium: string, referrerDomain: string | null = null, campaign: string | null = null): Source => ({
  source,
  medium,
  referrerDomain,
  campaign,
});

const SITES: DemoSite[] = [
  {
    name: "Demo docs site",
    search: [
      ["react chart library", "/docs/charts", 210, 6.8, 0.021],
      ["chart data status", "/blog/data-status-in-charts", 90, 3.1, 0.094],
      ["ui kit getting started", "/docs/getting-started", 160, 2.9, 0.102],
      ["component library docs", "/docs/components", 140, 3.2, 0.088],
      ["design tokens theming", "/docs/theming", 75, 3.0, 0.097],
      ["base ui components", "/docs/components", 120, 2.8, 0.105],
      ["dashboard ui kit", "/", 180, 3.1, 0.018],
      ["open source ui kit pricing", "/pricing", 45, 2.6, 0.11],
      ["chart tooltip accessibility", "/docs/charts", 38, 8.4, 0.024],
      ["dark mode tokens", "/docs/theming", 52, 11.2, 0.012],
      ["ui kit changelog", "/changelog", 24, 1.3, 0.34],
      ["provisional data in charts", "/blog/data-status-in-charts", 30, 4.6, 0.06],
    ],
    hostname: "docs.demo.example",
    timezone: "America/New_York",
    seed: 11,
    sessionsPerDay: 260,
    trend: 1.45,
    pages: [
      ["/", 18],
      ["/docs", 22],
      ["/docs/getting-started", 26],
      ["/docs/components", 14],
      ["/docs/theming", 8],
      ["/docs/charts", 9],
      ["/pricing", 5],
      ["/changelog", 4],
      ["/blog/data-status-in-charts", 6],
    ],
    sources: [
      [src("google", "organic", "google.com"), 46],
      [src("(direct)", "(none)"), 24],
      [src("github.com", "referral", "github.com"), 12],
      [src("x", "social", "t.co"), 7],
      [src("hackernews", "social", "news.ycombinator.com"), 4],
      [src("newsletter", "email", null, "october-release"), 5],
      [src("duckduckgo", "organic", "duckduckgo.com"), 2],
    ],
    events: [
      { name: "copy_install_command", rate: 0.11 },
      { name: "signup_completed", rate: 0.028, props: () => ({ plan: "free" }) },
    ],
    goals: [
      { name: "Signup", rules: { type: "custom_event", eventName: "signup_completed", props: {} } },
      { name: "Reached pricing", rules: { type: "page_visit", match: "exact", path: "/pricing" } },
    ],
  },
  {
    name: "Demo portfolio",
    search: null,
    hostname: "portfolio.demo.example",
    timezone: "Europe/Berlin",
    seed: 23,
    sessionsPerDay: 70,
    trend: 0.8,
    pages: [
      ["/", 40],
      ["/work", 20],
      ["/work/analytics-console", 12],
      ["/about", 14],
      ["/contact", 8],
      ["/notes/shipping-small-tools", 6],
    ],
    sources: [
      [src("(direct)", "(none)"), 38],
      [src("linkedin", "social", "linkedin.com"), 22],
      [src("google", "organic", "google.com"), 20],
      [src("x", "social", "t.co"), 12],
      [src("github.com", "referral", "github.com"), 8],
    ],
    events: [{ name: "contact_form_sent", rate: 0.02 }],
    goals: [{ name: "Contact form", rules: { type: "custom_event", eventName: "contact_form_sent", props: {} } }],
  },
  {
    name: "Demo storefront",
    search: [
      ["desk lamp", "/products/desk-lamp", 320, 9.4, 0.014],
      ["brass desk lamp", "/products/desk-lamp", 110, 4.2, 0.052],
      ["dotted notebook a5", "/products/notebook", 95, 3.0, 0.09],
      ["notebook shop", "/products", 130, 3.2, 0.085],
      ["stationery store online", "/", 150, 2.9, 0.092],
      ["desk accessories", "/products", 170, 3.1, 0.088],
      ["shipping times stationery", "/shipping", 40, 2.8, 0.1],
      ["lamp and notebook set", "/products", 60, 3.0, 0.02],
      ["paper notebook refill", "/products/notebook", 48, 7.1, 0.03],
    ],
    hostname: "shop.demo.example",
    timezone: "America/Los_Angeles",
    seed: 37,
    sessionsPerDay: 140,
    trend: 1.1,
    pages: [
      ["/", 24],
      ["/products", 22],
      ["/products/desk-lamp", 14],
      ["/products/notebook", 12],
      ["/cart", 9],
      ["/checkout", 5],
      ["/order/complete", 2],
      ["/shipping", 4],
    ],
    sources: [
      [src("google", "organic", "google.com"), 34],
      [src("(direct)", "(none)"), 26],
      [src("instagram", "social", "instagram.com"), 16],
      [src("newsletter", "email", null, "autumn-sale"), 12],
      [src("pinterest", "social", "pinterest.com"), 7],
      [src("bing", "organic", "bing.com"), 5],
    ],
    events: [
      { name: "add_to_cart", rate: 0.09, props: () => ({ placement: "product_page" }) },
      { name: "newsletter_signup", rate: 0.03, props: () => ({ placement: "footer" }) },
    ],
    goals: [
      { name: "Order completed", rules: { type: "page_visit", match: "starts_with", path: "/order/complete" } },
      { name: "Added to cart", rules: { type: "custom_event", eventName: "add_to_cart", props: {} } },
    ],
  },
];

const DEVICES: readonly (readonly [DeviceType, number])[] = [["desktop", 58], ["mobile", 37], ["tablet", 5]];
const BROWSERS: readonly (readonly [string, number])[] = [["Chrome", 55], ["Safari", 27], ["Firefox", 9], ["Edge", 6], ["Other", 3]];
const COUNTRIES: readonly (readonly [string | null, number])[] = [
  ["US", 38], ["DE", 12], ["GB", 10], ["IN", 8], ["CA", 6], ["FR", 5], ["NL", 4], ["BR", 4], ["AU", 3], ["JP", 3], [null, 7],
];
// Share of a day's sessions starting in each local hour.
const HOURS = [1, 1, 1, 1, 1, 2, 3, 5, 7, 8, 9, 9, 8, 8, 8, 7, 7, 6, 6, 5, 4, 3, 2, 1].map((w, h) => [h, w] as const);

async function clearDemo() {
  const db = getDb();
  const removed = await db.delete(schema.sites).where(eq(schema.sites.isDemo, true)).returning({ id: schema.sites.id });
  await db.delete(schema.integrations).where(eq(schema.integrations.isDemo, true));
  return removed.length;
}

const SEARCH_DAYS = 120;
const SEARCH_DEVICES = [["desktop", 0.52], ["mobile", 0.43], ["tablet", 0.05]] as const;
const SEARCH_COUNTRIES = [["usa", 0.41], ["deu", 0.14], ["gbr", 0.12], ["ind", 0.1], ["can", 0.08], ["fra", 0.06], ["nld", 0.05], ["zzz", 0.04]] as const;

/**
 * Synthetic Search Console data, written through the same storage functions the sync uses.
 * It is flagged as demo, has no Google account behind it, and is never synced.
 */
async function seedSearch(demo: DemoSite, siteId: string, integrationId: string, now: Date) {
  if (!demo.search) return 0;
  const db = getDb();
  const rand = mulberry32(demo.seed + 1000);
  const finalized = addDays(localDateOf(now, GSC_TIMEZONE), -3);
  const from = addDays(finalized, -(SEARCH_DAYS - 1));
  const origin = `https://${demo.hostname}`;
  const propertyId = await linkProperty(db, {
    siteId,
    integrationId,
    externalPropertyId: `sc-domain:${demo.hostname}`,
    externalPropertyType: "domain",
    permissionLevel: "siteOwner",
    backfillTarget: from,
    schedule: false,
  });
  const scope = { propertyId, siteId, from, to: finalized };
  const totals: Parameters<typeof replaceGscSiteDaily>[2] = [];
  const devices: Parameters<typeof replaceGscSegments>[3] = [];
  const countries: Parameters<typeof replaceGscSegments>[3] = [];
  const detail: GscDetailRows = { queries: [], pages: [], queryPages: [] };
  const split = (shares: readonly (readonly [string, number])[], value: number) => {
    let left = value;
    return shares.map(([key, share], index) => {
      const part = index === shares.length - 1 ? left : Math.min(left, Math.round(value * share));
      left -= part;
      return [key, part] as const;
    });
  };

  for (let offset = SEARCH_DAYS - 1; offset >= 0; offset--) {
    const date = addDays(finalized, -offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const progress = 1 - offset / (SEARCH_DAYS - 1);
    const factor = (1 + (demo.trend - 1) * progress) * (weekday === 0 || weekday === 6 ? 0.7 : 1);
    const day = { clicks: 0, impressions: 0, positionNumerator: 0 };
    const pages = new Map<string, { clicks: number; impressions: number; positionNumerator: number }>();
    const add = (target: { clicks: number; impressions: number; positionNumerator: number }, clicks: number, impressions: number, position: number) => {
      target.clicks += clicks;
      target.impressions += impressions;
      target.positionNumerator += position * impressions;
    };
    demo.search.forEach(([query, path, baseImpressions, basePosition, ctr], index) => {
      // The first page of each site loses half its search traffic in the last four weeks.
      const declining = index === 1 && offset < 28 ? 0.45 : 1;
      const impressions = Math.round(baseImpressions * factor * declining * (0.85 + rand() * 0.3));
      if (impressions <= 0) return;
      const position = Math.max(1, basePosition + (rand() - 0.5) * 0.8);
      const clicks = Math.round(impressions * ctr * (0.8 + rand() * 0.4));
      const pageUrl = `${origin}${path}`;
      const metrics = { clicks, impressions, positionNumerator: position * impressions };
      detail.queries.push({ date, query, ...metrics });
      detail.queryPages.push({ date, query, pageUrl, ...metrics });
      const page = pages.get(pageUrl) ?? { clicks: 0, impressions: 0, positionNumerator: 0 };
      add(page, clicks, impressions, position);
      pages.set(pageUrl, page);
      add(day, clicks, impressions, position);
    });
    // Searches Google reports in totals but under no query, as it does for real properties.
    const hiddenImpressions = Math.round(day.impressions * (0.28 + rand() * 0.08));
    const hiddenClicks = Math.round(hiddenImpressions * 0.035);
    add(day, hiddenClicks, hiddenImpressions, 12);
    const home = pages.get(`${origin}/`) ?? { clicks: 0, impressions: 0, positionNumerator: 0 };
    add(home, hiddenClicks, hiddenImpressions, 12);
    pages.set(`${origin}/`, home);

    totals.push({ date, ...day });
    for (const [pageUrl, metrics] of pages) detail.pages.push({ date, pageUrl, ...metrics });
    const position = day.positionNumerator / day.impressions;
    const deviceClicks = split(SEARCH_DEVICES, day.clicks);
    split(SEARCH_DEVICES, day.impressions).forEach(([value, impressions], i) => devices.push({ date, value, clicks: deviceClicks[i]![1], impressions, positionNumerator: position * impressions }));
    const countryClicks = split(SEARCH_COUNTRIES, day.clicks);
    split(SEARCH_COUNTRIES, day.impressions).forEach(([value, impressions], i) => countries.push({ date, value, clicks: countryClicks[i]![1], impressions, positionNumerator: position * impressions }));
  }

  await replaceGscSiteDaily(db, scope, totals);
  await replaceGscSegments(db, scope, "device", devices);
  await replaceGscSegments(db, scope, "country", countries);
  await replaceGscDetail(db, scope, detail);
  await updateProperty(db, propertyId, { finalizedThrough: finalized, oldestSyncedDate: from, lastSyncAt: now });
  await refreshOpportunities(db, propertyId);
  await db.insert(schema.urlInspections).values(
    [...new Set(demo.search.map(([, path]) => path))].slice(0, 4).map((path, index) => ({
      siteId,
      propertyId,
      url: `${origin}${path}`,
      checkedAt: new Date(now.getTime() - (index + 1) * 5 * 3_600_000),
      indexVerdict: index === 3 ? "NEUTRAL" : "PASS",
      coverageState: index === 3 ? "Crawled - currently not indexed" : "Submitted and indexed",
      crawledAs: "MOBILE",
      googleCanonical: index === 3 ? null : `${origin}${path}`,
      userCanonical: index === 3 ? null : `${origin}${path}`,
      lastCrawlAt: new Date(now.getTime() - (index + 2) * 86_400_000),
      robotsTxtState: "ALLOWED",
      indexingState: "INDEXING_ALLOWED",
      pageFetchState: "SUCCESSFUL",
      inspectionLink: null,
    })),
  );
  return totals.length;
}

async function seedSite(demo: DemoSite, now: Date) {
  const db = getDb();
  const rand = mulberry32(demo.seed);
  const { id: siteId } = await createSite(db, {
    name: demo.name,
    origin: `https://${demo.hostname}`,
    hostname: demo.hostname,
    timezone: demo.timezone,
    privacyMode: "default",
    isDemo: true,
  });
  await db.insert(schema.goals).values(demo.goals.map((g) => ({ siteId, name: g.name, type: g.rules.type, matchingRules: g.rules })));

  const today = localDateOf(now, demo.timezone);
  const events: QueuedEvent[] = [];
  let counter = 0;

  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const day = addDays(today, -offset);
    const dayStart = startOfLocalDay(day, demo.timezone).getTime();
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const progress = 1 - offset / (DAYS - 1);
    const weekdayFactor = weekday === 0 || weekday === 6 ? 0.62 : 1;
    const noise = 0.85 + rand() * 0.3;
    const sessions = Math.round(demo.sessionsPerDay * (1 + (demo.trend - 1) * progress) * weekdayFactor * noise);
    // A fixed pool per day gives some visitors more than one session.
    const visitorPool = Math.max(1, Math.round(sessions * 0.82));

    for (let s = 0; s < sessions; s++) {
      const start = dayStart + pick(rand, HOURS) * 3_600_000 + Math.floor(rand() * 3_600_000);
      if (start > now.getTime()) continue;
      const source = pick(rand, demo.sources);
      const deviceType = pick(rand, DEVICES);
      const browserFamily = pick(rand, BROWSERS);
      const countryCode = pick(rand, COUNTRIES);
      const sessionKey = key(`${siteId}|s|${day}|${s}`);
      const visitorKey = key(`${siteId}|v|${day}|${Math.floor(rand() * visitorPool)}`);
      const depth = pick(rand, [[1, 46], [2, 24], [3, 14], [4, 9], [6, 7]] as const);

      let at = start;
      let path = pick(rand, demo.pages);
      for (let p = 0; p < depth && at <= now.getTime(); p++) {
        const base = {
          siteId,
          sessionKey,
          visitorKey,
          referrerDomain: source.referrerDomain,
          source: source.source,
          medium: source.medium,
          campaign: source.campaign,
          countryCode,
          deviceType,
          browserFamily,
          botFlag: false,
        };
        const stamp = (ms: number) => new Date(ms).toISOString();
        events.push({ ...base, id: uuidFrom(`${siteId}|${counter++}`), eventType: "pageview", eventName: null, occurredAt: stamp(at), receivedAt: stamp(at + 400), normalizedPath: path, props: {}, engagedMs: null });
        for (const custom of demo.events) {
          if (rand() < custom.rate) {
            events.push({ ...base, id: uuidFrom(`${siteId}|${counter++}`), eventType: "custom", eventName: custom.name, occurredAt: stamp(at + 4000), receivedAt: stamp(at + 4400), normalizedPath: path, props: custom.props?.() ?? {}, engagedMs: null });
          }
        }
        const dwell = 4000 + Math.floor(rand() * 70_000);
        events.push({ ...base, id: uuidFrom(`${siteId}|${counter++}`), eventType: "engagement", eventName: null, occurredAt: stamp(Math.min(at + dwell, now.getTime())), receivedAt: stamp(Math.min(at + dwell, now.getTime()) + 300), normalizedPath: path, props: {}, engagedMs: Math.round(dwell * 0.8) });
        at += dwell + 1000;
        path = pick(rand, demo.pages);
      }
    }
  }

  let inserted = 0;
  for (let i = 0; i < events.length; i += 2000) inserted += await insertEvents(db, events.slice(i, i + 2000));
  return { siteId, inserted };
}

/**
 * Synthetic audit, performance, alert and annotation records, stored through the same
 * functions the worker uses. Nothing here was crawled or measured.
 */
async function seedHealth(demo: DemoSite, siteId: string, now: Date) {
  const db = getDb();
  const rand = mulberry32(demo.seed + 2000);
  const origin = `https://${demo.hostname}`;
  const paths = demo.pages.map(([path]) => path);
  const u = (path: string) => `${origin}${path}`;
  const finding = (ruleId: string, path: string, evidence: Record<string, unknown> = {}, key?: string) => ({ ruleId, url: u(path), key, evidence, severity: RULE_BY_ID.get(ruleId)!.severity });
  const last = paths[paths.length - 1]!;
  const steady = [
    finding("MISSING_META_DESC", paths[2]!),
    finding("MISSING_META_DESC", last),
    finding("DUPLICATE_TITLE", paths[1]!, { title: demo.name, sharedWith: [u(paths[3]!)], pages: 2 }),
    finding("DUPLICATE_TITLE", paths[3]!, { title: demo.name, sharedWith: [u(paths[1]!)], pages: 2 }),
    finding("ALT_MISSING", "/", { images: 3, examples: ["/img/hero.png"] }),
    finding("CANONICAL_MISSING", last),
    finding("MULTIPLE_H1", paths[1]!, { count: 2 }),
  ];
  const runs = [
    { daysAgo: 8, findings: [...steady, finding("BROKEN_INTERNAL_LINK", paths[2]!, { target: u("/old-page"), status: 404 }, u("/old-page")), finding("HTTP_4XX", "/old-page", { status: 404, linkedFrom: [u(paths[2]!)] })] },
    { daysAgo: 1, findings: [...steady, ...(demo.trend < 1 ? [finding("HTTP_5XX", last, { status: 503 })] : [finding("REDIRECT_CHAIN", "/start", { hops: 2, chain: [u("/start"), u("/begin")], finalUrl: u(paths[1]!) })])] },
  ];
  for (const run of runs) {
    const at = new Date(now.getTime() - run.daysAgo * 86_400_000);
    const [row] = await db
      .insert(schema.crawlRuns)
      .values({ siteId, kind: "full", trigger: "demo", status: "done", queuedAt: at, startedAt: at, finishedAt: new Date(at.getTime() + 42_000), maxPages: 500, pagesDiscovered: paths.length + 1, pagesCrawled: paths.length + 1, coverageComplete: true })
      .returning({ id: schema.crawlRuns.id });
    const runId = row!.id;
    const issuesPerUrl = new Map<string, number>();
    for (const f of run.findings) issuesPerUrl.set(f.url, (issuesPerUrl.get(f.url) ?? 0) + 1);
    await saveCrawlPages(
      db,
      { id: runId, siteId },
      paths.map((path, index) => ({
        url: u(path),
        statusCode: run.findings.some((f) => f.ruleId === "HTTP_5XX" && f.url === u(path)) ? 503 : 200,
        contentType: "text/html",
        responseMs: 120 + Math.floor(rand() * 400),
        inSitemap: true,
        indexable: true,
        title: path === "/" ? demo.name : `${path.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? "Page"} · ${demo.name}`,
        canonical: path === last ? null : u(path),
        h1: path === "/" ? demo.name : path,
        h1Count: path === paths[1] ? 2 : 1,
        wordCount: 300 + Math.floor(rand() * 900),
        internalInlinkCount: Math.max(1, paths.length - index),
        internalOutlinkCount: 4 + Math.floor(rand() * 6),
        issueCount: issuesPerUrl.get(u(path)) ?? 0,
        depth: path === "/" ? 0 : path.split("/").length - 1,
        detectedAt: at,
      })),
      [],
    );
    const counts = await applyFindings(db, { siteId, runId, complete: true, findings: run.findings, crawledUrls: paths.map(u), pageRuleIds: [], disabledRuleIds: [] });
    const summary: CrawlSummary = {
      open: await openIssueCounts(db, siteId),
      ...counts,
      score: auditScore(await openIssuesByRule(db, siteId), paths.length),
      scoreVersion: 1,
      eligiblePages: paths.length,
      stopReason: null,
      sitemaps: [{ url: u("/sitemap.xml"), ok: true, urls: paths.length }],
      robots: { found: true, status: 200 },
    };
    await db.update(schema.crawlRuns).set({ summary }).where(eq(schema.crawlRuns.id, runId));
  }

  /* Lab runs: thirty days, both devices, with a late dip on the declining site. */
  const lab: (typeof schema.performanceRuns.$inferInsert)[] = [];
  for (let day = 29; day >= 0; day--) {
    for (const device of ["mobile", "desktop"] as const) {
      const at = new Date(now.getTime() - day * 86_400_000 - 3 * 3_600_000);
      const base = (device === "mobile" ? 78 : 93) - (demo.trend < 1 && day < 6 ? 19 : 0);
      const performance = Math.max(20, Math.min(100, Math.round(base + (rand() - 0.5) * 6)));
      const slow = (100 - performance) / 100;
      lab.push({
        siteId,
        url: u("/"),
        device,
        provider: "demo",
        trigger: "demo",
        status: "done",
        queuedAt: at,
        checkedAt: at,
        finalUrl: u("/"),
        lighthouseVersion: "12.6.0",
        scores: { performance, accessibility: 96, bestPractices: 100, seo: 92 },
        metrics: { fcp: Math.round(900 + slow * 2400), lcp: Math.round(1500 + slow * 6000), speedIndex: Math.round(1400 + slow * 5000), tbt: Math.round(slow * 900), cls: Number((0.01 + slow * 0.1).toFixed(3)) },
        opportunities: [
          { id: "unused-javascript", title: "Reduce unused JavaScript", savingsMs: Math.round(200 + slow * 900), savingsBytes: 164_000 },
          { id: "render-blocking-resources", title: "Eliminate render-blocking resources", savingsMs: Math.round(100 + slow * 500), savingsBytes: null },
        ],
      });
    }
  }
  await db.insert(schema.performanceRuns).values(lab);

  /* Field data for the busier sites; the small one has none, as small sites often do. */
  if (demo.sessionsPerDay >= 100) {
    for (const formFactor of ["PHONE", "DESKTOP"] as const) {
      await upsertCruxHistory(
        db,
        Array.from({ length: 20 }, (_, i) => {
          const end = addDays(localDateOf(now, "UTC"), -(19 - i) * 7 - 2);
          return { siteId, key: origin, formFactor, periodStart: addDays(end, -27), periodEnd: end, lcpP75: Math.round((formFactor === "PHONE" ? 2300 : 1600) + (rand() - 0.5) * 300 + (demo.seed === 37 && i > 16 ? 500 : 0)), inpP75: Math.round((formFactor === "PHONE" ? 190 : 90) + (rand() - 0.5) * 40), clsP75: Number((0.06 + (rand() - 0.5) * 0.03).toFixed(3)) };
        }),
      );
    }
    await setCruxStatus(db, siteId, { checkedAt: now.toISOString(), PHONE: "ok", DESKTOP: "ok" });
  } else {
    await setCruxStatus(db, siteId, { checkedAt: now.toISOString(), PHONE: "no_data", DESKTOP: "no_data" });
  }

  const today = localDateOf(now, demo.timezone);
  await createAnnotation(db, { siteId, date: addDays(today, -18), type: "deployment", title: "Navigation redesign shipped", commitSha: "a1b2c3d" });
  await createAnnotation(db, { siteId, date: addDays(today, -6), type: "content", title: "Three guides rewritten" });

  if (demo.trend < 1) {
    await raiseAlert(db, { siteId, type: "new_critical_issue", entity: "HTTP_5XX", window: "demo", severity: "critical", headline: `1 new critical audit issue on ${demo.name}`, evidence: { rule: "HTTP_5XX", pages: 1, example: u(last) } });
    await raiseAlert(db, { siteId, type: "lighthouse_regression", entity: u("/"), window: "demo", severity: "warning", headline: `Mobile performance score for ${demo.name} fell from 78 to 59`, evidence: { url: u("/"), before: 78, previousRun: 60, latestRun: 59, lighthouseVersion: "12.6.0" } });
  }
}

async function demoIntegration() {
  return createIntegration(getDb(), {
    ownerUserId: null,
    accountLabel: "Synthetic demo data, not a Google account",
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    scope: null,
    expiresAt: null,
    isDemo: true,
  });
}

const removed = await clearDemo();
if (process.argv.includes("--clear")) {
  console.log(`Removed ${removed} demo ${removed === 1 ? "site" : "sites"}`);
} else {
  const now = new Date();
  const integrationId = await demoIntegration();
  for (const demo of SITES) {
    const { siteId, inserted } = await seedSite(demo, now);
    const searchDays = await seedSearch(demo, siteId, integrationId, now);
    await seedHealth(demo, siteId, now);
    console.log(`${demo.name}: ${inserted.toLocaleString("en-US")} synthetic events${searchDays ? `, ${searchDays} days of synthetic search data` : ", no search data"}`);
  }
  const { days } = await runAggregation(getDb());
  console.log(`Rolled up ${days} site-days. Set SCOPEKIT_DEMO=1 to show the demo sites`);
}
await closeDb();

/**
 * Stand-in for Google's OAuth and Search Console endpoints, used by the sync tests and for
 * walking through the connection flow locally. It follows the documented request and
 * response shapes, including final-only data, `first_incomplete_date`, row paging, queries
 * that are missing from query rows (anonymized), 429s and revoked grants.
 *
 *   npx tsx tests/mock-google.ts --port 9099 --property sc-domain:example.test
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

const PT = "America/Los_Angeles";
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" });
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const hash = (text: string) => createHash("sha256").update(text).digest().readUInt32BE(0);

type QuerySpec = { query: string; page: string; impressions: number; position: number; ctr: number };

const q = (query: string, page: string, impressions: number, position: number, ctr: number): QuerySpec => ({ query, page, impressions, position, ctr });
export const MOCK_QUERIES: QuerySpec[] = [
  // Six comparable queries around position 3, and one that is clicked far less often.
  q("survey instruments", "/", 40, 3.0, 0.1),
  q("field notebook", "/", 42, 3.1, 0.11),
  q("measuring tape accuracy", "/guides/accuracy", 38, 2.9, 0.1),
  q("theodolite basics", "/guides/theodolite", 44, 3.2, 0.09),
  q("how to read a level", "/guides/level", 36, 2.8, 0.1),
  q("survey marker types", "/guides/markers", 41, 3.0, 0.1),
  q("total station price", "/pricing", 60, 3.0, 0.02),
  // Steady, one clear page, just off the first results.
  q("gps rover setup", "/guides/gps-rover", 20, 8.0, 0.03),
  q("contour interval chart", "/guides/contours", 12, 14.0, 0.01),
  q("old guide to chaining", "/old-guide", 30, 5.0, 0.2),
  q("benchmark elevation lookup", "/guides/benchmarks", 15, 1.4, 0.3),
];
/** Clicks and impressions Google counts in property totals but shows under no query. */
const ANONYMIZED = { impressions: 55, position: 9.5, ctr: 0.04 };
const DEVICES = [
  ["DESKTOP", 0.55],
  ["MOBILE", 0.4],
  ["TABLET", 0.05],
] as const;
const COUNTRIES = [
  ["usa", 0.5],
  ["deu", 0.2],
  ["gbr", 0.15],
  ["ind", 0.1],
  ["zzz", 0.05],
] as const;

export type MockOptions = {
  port?: number;
  properties?: { siteUrl: string; permissionLevel: string }[];
  /** Days of history each property has, counted back from today. */
  historyDays?: number;
  /** Days between today and the newest final date. */
  lagDays?: number;
  now?: () => Date;
};

export type MockState = {
  /** Token and API calls fail as if the owner removed access. */
  revoked: boolean;
  /** The consent screen is declined. */
  denyConsent: boolean;
  /** After this many more API calls, the following `rateLimitFor` calls return 429. */
  rateLimitAfter: number | null;
  rateLimitFor: number;
  /** The next API call fails once with a 500. */
  failNext: boolean;
  /** Multiplies a date's figures, to stand in for Google revising a recent day. */
  revisions: Map<string, number>;
  /** Lab performance score (0 to 1) the next PageSpeed runs return, and the Lighthouse version. */
  psiScore: number;
  lighthouseVersion: string;
  /** Real-user p75 LCP in ms for the newest CrUX period; earlier periods stay at 2100. */
  cruxLatestLcp: number;
  /** Chrome has no field data for the origin. */
  cruxNoData: boolean;
  psiCalls: number;
  apiCalls: number;
  tokenCalls: number;
  log: { path: string; body: unknown }[];
};

type Row = { keys: string[]; clicks: number; impressions: number; positionSum: number };

export async function startMockGoogle(options: MockOptions = {}) {
  const now = options.now ?? (() => new Date());
  const lag = options.lagDays ?? 3;
  const historyDays = options.historyDays ?? 70;
  const properties = options.properties ?? [{ siteUrl: "sc-domain:example.test", permissionLevel: "siteOwner" }];
  const state: MockState = { revoked: false, denyConsent: false, rateLimitAfter: null, rateLimitFor: 0, failNext: false, revisions: new Map(), psiScore: 0.92, lighthouseVersion: "12.6.0", cruxLatestLcp: 2100, cruxNoData: false, psiCalls: 0, apiCalls: 0, tokenCalls: 0, log: [] };
  const challenges = new Map<string, string>();
  let issued = 0;

  const today = () => dayFormat.format(now());
  const finalizedThrough = () => addDays(today(), -lag);
  const historyStart = () => addDays(today(), -historyDays);

  /** Per-query figures for one day. Everything else is derived from these, as in Search Console. */
  function dayFacts(property: string, date: string) {
    const revision = state.revisions.get(date) ?? 1;
    // The old guide lost half its traffic four weeks before the newest final day.
    const declined = date >= addDays(finalizedThrough(), -27);
    const named = MOCK_QUERIES.map((spec) => {
      const base = spec.impressions + (hash(`${property}|${date}|${spec.query}`) % 5);
      const impressions = Math.round(base * revision * (spec.page === "/old-guide" && declined ? 0.4 : 1));
      return { ...spec, impressions, clicks: Math.round(impressions * spec.ctr) };
    });
    const hiddenImpressions = Math.round((ANONYMIZED.impressions + (hash(`${property}|${date}|anon`) % 7)) * revision);
    const hidden = { impressions: hiddenImpressions, clicks: Math.round(hiddenImpressions * ANONYMIZED.ctr), position: ANONYMIZED.position };
    return { named, hidden };
  }

  function datesIn(from: string, to: string, dataState: string) {
    const last = dataState === "final" ? finalizedThrough() : addDays(today(), -1);
    const out: string[] = [];
    for (let d = from < historyStart() ? historyStart() : from; d <= to && d <= last; d = addDays(d, 1)) out.push(d);
    return out;
  }

  const origin = (property: string) => (property.startsWith("sc-domain:") ? `https://${property.slice(10)}` : property.replace(/\/$/, ""));

  function analytics(property: string, body: Record<string, unknown>) {
    const dimensions = (body.dimensions as string[] | undefined) ?? [];
    const dataState = String(body.dataState ?? "final").toLowerCase();
    const groups = new Map<string, Row>();
    const add = (keys: string[], clicks: number, impressions: number, position: number) => {
      const id = keys.join("\u001f");
      const row = groups.get(id) ?? { keys, clicks: 0, impressions: 0, positionSum: 0 };
      row.clicks += clicks;
      row.impressions += impressions;
      row.positionSum += position * impressions;
      groups.set(id, row);
    };
    const split = (shares: readonly (readonly [string, number])[], value: number) => {
      // Integer shares that add up exactly to the whole.
      let left = value;
      return shares.map(([key, share], index) => {
        const part = index === shares.length - 1 ? left : Math.min(left, Math.round(value * share));
        left -= part;
        return [key, part] as const;
      });
    };
    for (const date of datesIn(String(body.startDate), String(body.endDate), dataState)) {
      const { named, hidden } = dayFacts(property, date);
      const perQuery = dimensions.includes("query") || dimensions.includes("page");
      // Anonymized queries are counted in totals and by-page rows, but never appear as a query.
      const facts = [
        ...named.map((n) => ({ query: n.query as string | null, page: n.page, clicks: n.clicks, impressions: n.impressions, position: n.position })),
        ...(dimensions.includes("query") ? [] : [{ query: null, page: "/", clicks: hidden.clicks, impressions: hidden.impressions, position: hidden.position }]),
      ];
      for (const fact of facts) {
        const fixed = dimensions.map((d) => (d === "date" ? date : d === "query" ? fact.query! : d === "page" ? `${origin(property)}${fact.page}` : null));
        const segment = dimensions.includes("device") ? DEVICES : dimensions.includes("country") ? COUNTRIES : null;
        if (!segment || perQuery) {
          add(fixed.map((k) => k ?? ""), fact.clicks, fact.impressions, fact.position);
          continue;
        }
        const clicks = split(segment, fact.clicks);
        split(segment, fact.impressions).forEach(([key, impressions], index) => {
          if (impressions > 0) add(fixed.map((k) => k ?? key), clicks[index]![1], impressions, fact.position);
        });
      }
    }
    let rows = [...groups.values()].filter((r) => r.impressions > 0);
    rows.sort((a, b) => (dimensions[0] === "date" ? a.keys[0]!.localeCompare(b.keys[0]!) : 0) || b.clicks - a.clicks || a.keys.join().localeCompare(b.keys.join()));
    const startRow = Number(body.startRow ?? 0);
    rows = rows.slice(startRow, startRow + Number(body.rowLimit ?? 1000));
    const response: Record<string, unknown> = {
      rows: rows.map((r) => ({ keys: r.keys, clicks: r.clicks, impressions: r.impressions, ctr: r.clicks / r.impressions, position: r.positionSum / r.impressions })),
      responseAggregationType: body.aggregationType === "byPage" || dimensions.includes("page") ? "byPage" : "byProperty",
    };
    if (dataState === "all" && dimensions.includes("date") && String(body.endDate) > finalizedThrough()) {
      response.metadata = { first_incomplete_date: addDays(finalizedThrough(), 1) };
    }
    return response;
  }

  /** What Search Console itself would show for the property and range. */
  function expectedTotals(property: string, from: string, to: string) {
    let clicks = 0;
    let impressions = 0;
    let positionSum = 0;
    let namedClicks = 0;
    for (const date of datesIn(from, to, "final")) {
      const { named, hidden } = dayFacts(property, date);
      for (const n of [...named, hidden]) {
        clicks += n.clicks;
        impressions += n.impressions;
        positionSum += n.position * n.impressions;
      }
      namedClicks += named.reduce((sum, n) => sum + n.clicks, 0);
    }
    return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: impressions ? positionSum / impressions : null, namedClicks };
  }

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  };
  const apiError = (res: ServerResponse, status: number, reason: string, message: string, headers: Record<string, string> = {}) =>
    send(res, status, { error: { code: status, message, errors: [{ reason, message }] } }, headers);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const raw = req.method === "POST" ? await read(req) : "";

    if (url.pathname === "/o/oauth2/v2/auth") {
      const redirect = new URL(url.searchParams.get("redirect_uri") ?? "http://localhost");
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (state.denyConsent) redirect.searchParams.set("error", "access_denied");
      else {
        const code = `mock-code-${++issued}`;
        challenges.set(code, url.searchParams.get("code_challenge") ?? "");
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("scope", url.searchParams.get("scope") ?? "");
      }
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }

    if (url.pathname === "/token") {
      state.tokenCalls++;
      const form = new URLSearchParams(raw);
      const grant = form.get("grant_type");
      if (state.revoked) return send(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      if (grant === "authorization_code") {
        const code = form.get("code") ?? "";
        const challenge = challenges.get(code);
        const verifier = form.get("code_verifier") ?? "";
        if (challenge === undefined || createHash("sha256").update(verifier).digest("base64url") !== challenge) {
          return send(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        }
        challenges.delete(code);
        return send(res, 200, { access_token: `mock-access-${++issued}`, refresh_token: "mock-refresh-token", expires_in: 3600, scope: "https://www.googleapis.com/auth/webmasters.readonly", token_type: "Bearer" });
      }
      if (grant === "refresh_token" && form.get("refresh_token") === "mock-refresh-token") {
        return send(res, 200, { access_token: `mock-access-${++issued}`, expires_in: 3600, scope: "https://www.googleapis.com/auth/webmasters.readonly", token_type: "Bearer" });
      }
      return send(res, 400, { error: "invalid_grant" });
    }

    if (url.pathname === "/revoke") {
      state.revoked = true;
      return send(res, 200, {});
    }

    // PageSpeed Insights and the Chrome UX Report use an API key, not a bearer token.
    if (url.pathname === "/pagespeedonline/v5/runPagespeed") {
      state.psiCalls++;
      if (!url.searchParams.get("key")) return apiError(res, 403, "forbidden", "API key missing");
      if (state.rateLimitAfter === 0 && state.rateLimitFor > 0) {
        state.rateLimitFor--;
        return apiError(res, 429, "rateLimitExceeded", "Quota exceeded");
      }
      const target = url.searchParams.get("url") ?? "";
      const mobile = url.searchParams.get("strategy") === "MOBILE";
      const perf = Math.max(0, state.psiScore - (mobile ? 0 : -0.04));
      return send(res, 200, {
        id: target,
        lighthouseResult: {
          lighthouseVersion: state.lighthouseVersion,
          finalDisplayedUrl: target,
          fetchTime: now().toISOString(),
          categories: { performance: { score: perf }, accessibility: { score: 0.96 }, "best-practices": { score: 1 }, seo: { score: 0.91 } },
          audits: {
            "first-contentful-paint": { title: "First Contentful Paint", score: 0.9, numericValue: 1400 },
            "largest-contentful-paint": { title: "Largest Contentful Paint", score: perf, numericValue: Math.round(2000 + (1 - perf) * 6000) },
            "speed-index": { title: "Speed Index", score: 0.8, numericValue: 2600 },
            "total-blocking-time": { title: "Total Blocking Time", score: 0.7, numericValue: Math.round((1 - perf) * 900) },
            "cumulative-layout-shift": { title: "Cumulative Layout Shift", score: 1, numericValue: 0.02 },
            "unused-javascript": { title: "Reduce unused JavaScript", score: 0.4, details: { type: "opportunity", overallSavingsMs: 450, overallSavingsBytes: 182000 } },
            "render-blocking-resources": { title: "Eliminate render-blocking resources", score: 0.6, details: { type: "opportunity", overallSavingsMs: 210 } },
            "uses-text-compression": { title: "Enable text compression", score: 1, details: { type: "opportunity", overallSavingsMs: 0 } },
            "final-screenshot": { title: "Final Screenshot", score: null, details: { type: "screenshot", data: "data:image/jpeg;base64,AAAA" } },
          },
        },
      });
    }
    if (url.pathname === "/v1/records:queryHistoryRecord") {
      if (state.cruxNoData) return send(res, 404, { error: { code: 404, message: "chrome ux report data not found", status: "NOT_FOUND" } });
      const weeks = 12;
      const day = (offset: number) => {
        const d = new Date(now().getTime() - offset * 86_400_000);
        return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      };
      const periods = Array.from({ length: weeks }, (_, i) => ({ firstDate: day((weeks - i) * 7 + 27), lastDate: day((weeks - i) * 7) }));
      const flat = (value: number | string) => Array.from({ length: weeks }, () => value);
      return send(res, 200, {
        record: {
          key: JSON.parse(raw || "{}"),
          metrics: {
            largest_contentful_paint: { percentilesTimeseries: { p75s: [...flat(2100).slice(1), state.cruxLatestLcp] } },
            interaction_to_next_paint: { percentilesTimeseries: { p75s: flat(180) } },
            cumulative_layout_shift: { percentilesTimeseries: { p75s: flat("0.05") } },
          },
          collectionPeriods: periods,
        },
      });
    }

    // Everything below is the API and needs a bearer token.
    state.apiCalls++;
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    state.log.push({ path: url.pathname, body });
    if (state.revoked || !/^Bearer mock-access-\d+$/.test(req.headers.authorization ?? "")) {
      return apiError(res, 401, "authError", "Invalid Credentials");
    }
    if (state.failNext) {
      state.failNext = false;
      return apiError(res, 500, "backendError", "Backend Error");
    }
    if (state.rateLimitAfter !== null) {
      if (state.rateLimitAfter > 0) state.rateLimitAfter--;
      else if (state.rateLimitFor > 0) {
        state.rateLimitFor--;
        if (state.rateLimitFor === 0) state.rateLimitAfter = null;
        return apiError(res, 429, "rateLimitExceeded", "Quota exceeded for quota metric 'Queries'", { "retry-after": "2" });
      }
    }

    if (url.pathname === "/webmasters/v3/sites") return send(res, 200, { siteEntry: properties });

    const match = /^\/webmasters\/v3\/sites\/(.+)\/searchAnalytics\/query$/.exec(url.pathname);
    if (match) {
      const property = decodeURIComponent(match[1]!);
      const entry = properties.find((p) => p.siteUrl === property);
      if (!entry || entry.permissionLevel === "siteUnverifiedUser") return apiError(res, 403, "forbidden", `User does not have sufficient permission for site '${property}'.`);
      return send(res, 200, analytics(property, body));
    }

    if (url.pathname === "/v1/urlInspection/index:inspect") {
      const property = String(body.siteUrl);
      const target = String(body.inspectionUrl);
      const path = new URL(target).pathname;
      const known = MOCK_QUERIES.some((spec) => spec.page === path);
      return send(res, 200, {
        inspectionResult: {
          inspectionResultLink: `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(property)}&id=mock`,
          indexStatusResult: known
            ? {
                verdict: "PASS",
                coverageState: "Submitted and indexed",
                robotsTxtState: "ALLOWED",
                indexingState: "INDEXING_ALLOWED",
                lastCrawlTime: new Date(now().getTime() - 2 * 86_400_000).toISOString(),
                pageFetchState: "SUCCESSFUL",
                googleCanonical: target,
                userCanonical: target,
                crawledAs: "MOBILE",
              }
            : { verdict: "NEUTRAL", coverageState: "URL is unknown to Google", robotsTxtState: "ROBOTS_TXT_STATE_UNSPECIFIED", indexingState: "INDEXING_STATE_UNSPECIFIED", pageFetchState: "PAGE_FETCH_STATE_UNSPECIFIED" },
        },
      });
    }

    apiError(res, 404, "notFound", "Not Found");
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    finalizedThrough,
    historyStart,
    expectedTotals,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name: string) => {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? process.argv[index + 1] : undefined;
  };
  const property = arg("property") ?? "sc-domain:example.test";
  const mock = await startMockGoogle({
    port: Number(arg("port") ?? 9099),
    historyDays: Number(arg("history") ?? 120),
    properties: [
      { siteUrl: property, permissionLevel: "siteOwner" },
      { siteUrl: "https://www.unrelated.test/", permissionLevel: "siteFullUser" },
      { siteUrl: "sc-domain:unverified.test", permissionLevel: "siteUnverifiedUser" },
    ],
  });
  console.log(`Mock Google listening on ${mock.url}. Set SCOPEKIT_GOOGLE_BASE_URL=${mock.url}`);
}

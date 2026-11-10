import type { OpportunityPageInput, OpportunityQueryInput } from "@scopekit/db";
import { describe, expect, it } from "vitest";
import { alpha2Of } from "./countries";
import { decryptSecret, encryptSecret, loadMasterKey, pkceChallenge, safeEqual } from "./crypto";
import { buildAuthUrl, googleConfigFromEnv, GSC_SCOPE } from "./google";
import { ctrOf, positionOf, resolveGscRange, sumMetrics, toStored } from "./metrics";
import { detectOpportunities, scoreOf } from "./opportunities";
import { parseProperty, propertyMatchesSite, urlInProperty } from "./property";
import { backfillProgress } from "./sync";

const key = Buffer.alloc(32, 7);

describe("token encryption", () => {
  it("round-trips and never contains the plaintext", () => {
    const sealed = encryptSecret("1//refresh-token-value", key);
    expect(sealed).not.toContain("refresh-token-value");
    expect(decryptSecret(sealed, key)).toBe("1//refresh-token-value");
  });
  it("produces a different ciphertext every time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });
  it("rejects a tampered value and a different master key", () => {
    const sealed = encryptSecret("secret", key);
    const [version, wrapped, body] = sealed.split(".");
    const flipped = `${version}.${wrapped}.${body!.slice(0, -2)}${body!.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => decryptSecret(flipped, key)).toThrow();
    expect(() => decryptSecret(sealed, Buffer.alloc(32, 8))).toThrow();
    expect(() => decryptSecret("not-a-secret", key)).toThrow();
  });
  it("accepts a hex or base64 master key and refuses a short one", () => {
    expect(loadMasterKey("ab".repeat(32))?.length).toBe(32);
    expect(loadMasterKey(key.toString("base64"))?.length).toBe(32);
    expect(loadMasterKey("")).toBeNull();
    expect(() => loadMasterKey("too-short")).toThrow();
  });
});

describe("oauth request", () => {
  const config = googleConfigFromEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", BETTER_AUTH_URL: "https://scope.example/" })!;
  it("is not configured without a client", () => {
    expect(googleConfigFromEnv({})).toBeNull();
  });
  it("asks for read-only access with PKCE and offline access", () => {
    const url = new URL(buildAuthUrl(config, { state: "state-1", codeVerifier: "verifier-1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GSC_SCOPE);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("verifier-1"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("https://scope.example/api/integrations/google/callback");
    expect(url.toString()).not.toContain("verifier-1");
  });
  it("matches the RFC 7636 example challenge", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("compares state values without leaking length mismatches as a match", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("search metrics", () => {
  it("weights average position by impressions", () => {
    const rows = [toStored({ clicks: 10, impressions: 100, position: 2 }), toStored({ clicks: 1, impressions: 900, position: 12 })];
    const total = sumMetrics(rows);
    expect(positionOf(total)).toBeCloseTo(11, 10);
    // The unweighted mean of 2 and 12 would be 7, which is wrong.
    expect(positionOf(total)).not.toBeCloseTo(7, 1);
  });
  it("computes CTR from totals, not from daily CTRs", () => {
    const total = sumMetrics([toStored({ clicks: 5, impressions: 10, position: 1 }), toStored({ clicks: 0, impressions: 990, position: 1 })]);
    expect(ctrOf(total)).toBeCloseTo(0.005, 10);
  });
  it("has no CTR or position without impressions", () => {
    expect(ctrOf({ clicks: 0, impressions: 0 })).toBeNull();
    expect(positionOf({ impressions: 0, positionNumerator: 0 })).toBeNull();
  });
});

describe("finalized ranges", () => {
  const finalizedThrough = "2026-11-05";
  it("ends presets on the last finalized day and compares equal lengths", () => {
    const range = resolveGscRange({ preset: "7d", finalizedThrough });
    expect(range).toMatchObject({ from: "2026-10-30", to: "2026-11-05", days: 7, clamped: false });
    expect(range.previous).toEqual({ from: "2026-10-23", to: "2026-10-29" });
  });
  it("pulls a custom range back to the finalized day", () => {
    const range = resolveGscRange({ preset: "custom", from: "2026-11-01", to: "2026-11-09", finalizedThrough });
    expect(range).toMatchObject({ from: "2026-11-01", to: "2026-11-05", days: 5, clamped: true });
    expect(range.previous).toEqual({ from: "2026-10-27", to: "2026-10-31" });
  });
  it("falls back from today and 24h, which search data cannot answer", () => {
    expect(resolveGscRange({ preset: "today", finalizedThrough, fallbackPreset: "7d" }).days).toBe(7);
    expect(resolveGscRange({ preset: "24h", finalizedThrough }).days).toBe(30);
  });
  it("handles a custom range that starts after the finalized day", () => {
    expect(resolveGscRange({ preset: "custom", from: "2026-11-08", to: "2026-11-09", finalizedThrough })).toMatchObject({ from: "2026-11-05", to: "2026-11-05", days: 1 });
  });
});

describe("properties", () => {
  const domain = parseProperty("sc-domain:example.com")!;
  const prefix = parseProperty("https://www.example.com/blog/")!;
  it("parses both kinds and rejects anything else", () => {
    expect(domain).toMatchObject({ type: "domain", hostname: "example.com" });
    expect(prefix).toMatchObject({ type: "url_prefix", hostname: "www.example.com", label: "www.example.com/blog/" });
    expect(parseProperty("ftp://example.com/")).toBeNull();
    expect(parseProperty("sc-domain:")).toBeNull();
  });
  it("matches a domain property to the site and its subdomains only", () => {
    expect(propertyMatchesSite(domain, ["www.example.com"])).toBe(true);
    expect(propertyMatchesSite(domain, ["example.com"])).toBe(true);
    expect(propertyMatchesSite(domain, ["notexample.com"])).toBe(false);
    expect(propertyMatchesSite(domain, ["example.com.evil.test"])).toBe(false);
  });
  it("matches a URL-prefix property by hostname, treating www as the same site", () => {
    expect(propertyMatchesSite(prefix, ["example.com"])).toBe(true);
    expect(propertyMatchesSite(prefix, ["shop.example.com"])).toBe(false);
  });
  it("only allows inspecting URLs inside the property", () => {
    expect(urlInProperty("https://docs.example.com/a", domain)).toBe(true);
    expect(urlInProperty("https://example.org/a", domain)).toBe(false);
    expect(urlInProperty("https://www.example.com/blog/post", prefix)).toBe(true);
    expect(urlInProperty("https://www.example.com/pricing", prefix)).toBe(false);
    expect(urlInProperty("javascript:alert(1)", domain)).toBe(false);
  });
});

describe("opportunity rules", () => {
  const window = { from: "2026-10-09", to: "2026-11-05" };
  const previousWindow = { from: "2026-09-11", to: "2026-10-08" };
  const query = (name: string, impressions: number, position: number, ctr: number, extra: Partial<OpportunityQueryInput> = {}): OpportunityQueryInput => ({
    query: name,
    impressions,
    clicks: Math.round(impressions * ctr),
    positionNumerator: position * impressions,
    weeksWithImpressions: 4,
    topPage: `https://example.com/${name.replace(/\s/g, "-")}`,
    topPageShare: 1,
    ...extra,
  });
  const peers = Array.from({ length: 6 }, (_, i) => query(`peer ${i}`, 1000, 3, 0.1));
  const run = (queries: OpportunityQueryInput[], pages: OpportunityPageInput[] = [], historyFrom: string | null = "2026-08-01") =>
    detectOpportunities({ window, previousWindow, historyFrom, queries, pages });

  it("flags a query whose CTR is well below its position cohort", () => {
    const found = run([...peers, query("weak", 1500, 3, 0.02)]);
    const weak = found.find((o) => o.rule === "low_ctr");
    expect(weak?.subject).toBe("weak");
    expect(weak?.evidence.cohortCtr).toBeCloseTo(0.1, 5);
    expect(found.filter((o) => o.rule === "low_ctr")).toHaveLength(1);
  });
  it("does not flag low CTR without enough impressions or without a cohort to compare with", () => {
    expect(run([...peers, query("small", 300, 3, 0.02)]).some((o) => o.rule === "low_ctr")).toBe(false);
    expect(run([query("alone", 5000, 3, 0.001)]).some((o) => o.rule === "low_ctr")).toBe(false);
  });
  it("does not flag a CTR inside the margin", () => {
    expect(run([...peers, query("fine", 1500, 3, 0.08)]).some((o) => o.rule === "low_ctr")).toBe(false);
  });
  it("flags steady queries just off page one only when one page clearly matches", () => {
    expect(run([query("near", 600, 8, 0.03)]).some((o) => o.rule === "near_page_one" && o.subject === "near")).toBe(true);
    expect(run([query("split", 600, 8, 0.03, { topPageShare: 0.4 })]).some((o) => o.rule === "near_page_one")).toBe(false);
    expect(run([query("spiky", 600, 8, 0.03, { weeksWithImpressions: 1 })]).some((o) => o.rule === "near_page_one")).toBe(false);
    expect(run([query("far", 600, 35, 0.01)]).some((o) => o.rule === "near_page_one")).toBe(false);
  });
  const page = (clicks: number, previousClicks: number, firstSeen = "2026-09-11"): OpportunityPageInput => ({ pageUrl: "https://example.com/p", clicks, previousClicks, impressions: 2000, previousImpressions: 2500, firstSeen });
  it("flags a page down more than 20% and at least 25 clicks", () => {
    expect(run([], [page(100, 200)]).map((o) => o.rule)).toEqual(["declining_clicks"]);
    expect(run([], [page(170, 200)])).toHaveLength(0);
    expect(run([], [page(10, 30)])).toHaveLength(0);
  });
  it("skips pages first seen during the earlier period and sites without enough history", () => {
    expect(run([], [page(100, 200, "2026-10-01")])).toHaveLength(0);
    expect(run([], [page(100, 200)], "2026-10-01")).toHaveLength(0);
    expect(run([], [page(100, 200)], null)).toHaveLength(0);
  });
  it("keeps scores between 0 and 100 and orders by score", () => {
    const found = run([...peers, query("weak", 1500, 3, 0.02), query("near", 600, 8, 0.03)], [page(100, 200)]);
    expect(found.every((o) => o.score >= 0 && o.score <= 100)).toBe(true);
    expect([...found].sort((a, b) => b.score - a.score).map((o) => o.subject)).toEqual(found.map((o) => o.subject));
    expect(scoreOf({ volume: 5, gap: 5, position: 5, confidence: 5 })).toBe(100);
    expect(scoreOf({ volume: -1, gap: -1, position: -1, confidence: 1 })).toBe(0);
  });
});

describe("helpers", () => {
  it("maps Search Console country codes", () => {
    expect(alpha2Of("usa")).toBe("US");
    expect(alpha2Of("DEU")).toBe("DE");
    expect(alpha2Of("zzz")).toBeNull();
  });
  it("reports backfill progress in days", () => {
    expect(backfillProgress({ backfillTarget: "2026-01-01", oldestSyncedDate: "2026-01-06", finalizedThrough: "2026-01-10" })).toEqual({ done: 5, total: 10, complete: false });
    expect(backfillProgress({ backfillTarget: "2026-01-01", oldestSyncedDate: "2026-01-01", finalizedThrough: "2026-01-10" })?.complete).toBe(true);
    expect(backfillProgress({ backfillTarget: "2026-01-01", oldestSyncedDate: null, finalizedThrough: null })).toBeNull();
  });
});

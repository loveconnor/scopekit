import { describe, expect, it } from "vitest";
import { aggregateDay, goalMatchesEvent, type DayEvent } from "./aggregate";
import { isExcludedPath, normalizeOrigin, normalizePath, sanitizeProps } from "./normalize";
import { classifySource } from "./source";
import { addDays, daysInclusive, localDateOf, resolveRange, startOfLocalDay } from "./time";
import { parseUserAgent } from "./ua";

describe("normalizePath", () => {
  it("drops tracking parameters, fragments and trailing slashes", () => {
    expect(normalizePath("/docs/?utm_source=x&utm_medium=y#intro")).toBe("/docs");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("//a///b/")).toBe("/a/b");
  });

  it("keeps only allowlisted query parameters, in a stable order", () => {
    expect(normalizePath("/search?tab=b&page=2&token=abc&utm_campaign=x", ["page", "tab", "token"])).toBe("/search?page=2&tab=b");
    expect(normalizePath("/search?page=2&tab=b", ["tab", "page"])).toBe(normalizePath("/search?tab=b&page=2", ["tab", "page"]));
  });

  it("preserves path case", () => {
    expect(normalizePath("/Docs/API")).toBe("/Docs/API");
  });
});

describe("isExcludedPath", () => {
  it("treats a trailing * as a prefix and everything else as exact", () => {
    expect(isExcludedPath("/admin/users", ["/admin*"])).toBe(true);
    expect(isExcludedPath("/administrator", ["/admin/*"])).toBe(false);
    expect(isExcludedPath("/preview", ["/preview"])).toBe(true);
    expect(isExcludedPath("/preview/1", ["/preview"])).toBe(false);
  });
});

describe("sanitizeProps", () => {
  it("drops sensitive keys, PII-looking values and nested data", () => {
    const { props, dropped } = sanitizeProps({
      plan: "free",
      count: 3,
      ok: true,
      email: "a@b.co",
      authToken: "x",
      author: "docs-team",
      contact: "reach me at a@b.co",
      phoneish: "+1 (555) 010-2000",
      nested: { a: 1 },
      list: [1, 2],
    });
    expect(props).toEqual({ plan: "free", count: 3, ok: true, author: "docs-team" });
    expect(dropped.sort()).toEqual(["authToken", "contact", "email", "list", "nested", "phoneish"]);
  });

  it("keeps at most 10 properties", () => {
    const input = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeProps(input).props)).toHaveLength(10);
  });
});

describe("normalizeOrigin", () => {
  it("accepts bare domains and full URLs", () => {
    expect(normalizeOrigin("Example.com/path")).toEqual({ origin: "https://example.com", hostname: "example.com" });
    expect(normalizeOrigin("http://localhost:3000")).toEqual({ origin: "http://localhost:3000", hostname: "localhost:3000" });
  });

  it("rejects credentials and non-web schemes", () => {
    expect(() => normalizeOrigin("https://user:pw@example.com")).toThrow();
    expect(() => normalizeOrigin("ftp://example.com")).toThrow();
    expect(() => normalizeOrigin("intranet")).toThrow();
  });
});

describe("classifySource", () => {
  const own = ["example.com", "www.example.com"];

  it("keeps only the referrer domain", () => {
    const result = classifySource({ referrer: "https://www.google.com/search?q=private+query", ownHostnames: own });
    expect(result).toEqual({ source: "google", medium: "organic", campaign: null, referrerDomain: "google.com" });
  });

  it("does not treat the site's own pages as a referrer", () => {
    expect(classifySource({ referrer: "https://www.example.com/pricing", ownHostnames: own })).toEqual({
      source: "(direct)",
      medium: "(none)",
      campaign: null,
      referrerDomain: null,
    });
  });

  it("lets utm parameters win and classifies social and referral traffic", () => {
    expect(classifySource({ referrer: "https://t.co/abc", utm: { source: "Newsletter", medium: "Email", campaign: "Oct" }, ownHostnames: own })).toMatchObject({
      source: "newsletter",
      medium: "email",
      campaign: "oct",
    });
    expect(classifySource({ referrer: "https://t.co/abc", ownHostnames: own })).toMatchObject({ source: "x", medium: "social" });
    expect(classifySource({ referrer: "https://blog.partner.dev/post", ownHostnames: own })).toMatchObject({ source: "blog.partner.dev", medium: "referral" });
    expect(classifySource({ referrer: "android-app://com.example", ownHostnames: own })).toMatchObject({ source: "(direct)" });
  });
});

describe("parseUserAgent", () => {
  it("classifies device, browser and bots", () => {
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(chrome)).toEqual({ deviceType: "desktop", browserFamily: "Chrome", isBot: false });
    expect(parseUserAgent(iphone)).toEqual({ deviceType: "mobile", browserFamily: "Safari", isBot: false });
    expect(parseUserAgent(`${chrome} Edg/141.0`).browserFamily).toBe("Edge");
    expect(parseUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)").isBot).toBe(true);
    expect(parseUserAgent(chrome.replace("Chrome/", "HeadlessChrome/")).isBot).toBe(true);
    expect(parseUserAgent("").isBot).toBe(true);
  });
});

describe("time", () => {
  it("buckets instants into the site's local day, across DST changes", () => {
    // US clocks fall back on 2026-11-01: that local day is 25 hours long.
    const start = startOfLocalDay("2026-11-01", "America/New_York");
    const end = startOfLocalDay("2026-11-02", "America/New_York");
    expect(start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
    expect(localDateOf(new Date("2026-11-02T04:59:59Z"), "America/New_York")).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-02T05:00:00Z"), "America/New_York")).toBe("2026-11-02");

    // Spring forward on 2026-03-08: 23 hours.
    const spring = startOfLocalDay("2026-03-08", "America/New_York");
    expect((startOfLocalDay("2026-03-09", "America/New_York").getTime() - spring.getTime()) / 3_600_000).toBe(23);
  });

  it("uses the site timezone, not UTC or the server's", () => {
    const instant = new Date("2026-11-09T23:30:00Z");
    expect(localDateOf(instant, "UTC")).toBe("2026-11-09");
    expect(localDateOf(instant, "Asia/Tokyo")).toBe("2026-11-10");
  });

  it("defaults to complete days and an equal-length comparison period", () => {
    const range = resolveRange({ preset: "30d", timeZone: "America/New_York", now: new Date("2026-11-09T20:00:00Z") });
    expect([range.from, range.to, range.days, range.includesToday]).toEqual(["2026-10-10", "2026-11-08", 30, false]);
    expect([range.previous.from, range.previous.to]).toEqual(["2026-09-10", "2026-10-09"]);
    expect(daysInclusive(range.previous.from, range.previous.to)).toBe(range.days);
    expect(range.end.toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });

  it("compares an unfinished day with yesterday up to the same time", () => {
    const now = new Date("2026-11-09T20:00:00Z"); // 15:00 in New York
    const range = resolveRange({ preset: "today", timeZone: "America/New_York", now });
    expect([range.from, range.to, range.granularity, range.includesToday]).toEqual(["2026-11-09", "2026-11-09", "hour", true]);
    expect(range.previous.start.toISOString()).toBe("2026-11-08T05:00:00.000Z");
    expect(range.previous.end.toISOString()).toBe("2026-11-08T20:00:00.000Z");
  });

  it("clamps custom ranges to today and falls back on bad input", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    expect(resolveRange({ preset: "custom", from: "2026-11-01", to: "2027-01-01", timeZone: "UTC", now }).to).toBe("2026-11-09");
    expect(resolveRange({ preset: "custom", from: "nope", to: "2026-11-01", timeZone: "UTC", now }).preset).toBe("30d");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("aggregateDay", () => {
  let clock = Date.parse("2026-11-08T10:00:00Z");
  const event = (overrides: Partial<DayEvent>): DayEvent => ({
    eventType: "pageview",
    eventName: null,
    occurredAt: new Date((clock += 1000)),
    normalizedPath: "/",
    sessionKey: "s1",
    visitorKey: "v1",
    referrerDomain: null,
    source: "(direct)",
    medium: "(none)",
    campaign: null,
    countryCode: "US",
    deviceType: "desktop",
    browserFamily: "Chrome",
    props: {},
    engagedMs: null,
    ...overrides,
  });

  const goals = [
    { id: "signup", enabled: true, rules: { type: "custom_event" as const, eventName: "signup_completed", props: { plan: "pro" } } },
    { id: "pricing", enabled: true, rules: { type: "page_visit" as const, match: "starts_with" as const, path: "/pricing" } },
    { id: "off", enabled: false, rules: { type: "page_visit" as const, match: "exact" as const, path: "/" } },
  ];

  const events: DayEvent[] = [
    // Session 1: three pages, converts twice on the same goal.
    event({ sessionKey: "s1", visitorKey: "v1", normalizedPath: "/", source: "google", medium: "organic", referrerDomain: "google.com" }),
    event({ sessionKey: "s1", visitorKey: "v1", normalizedPath: "/pricing", source: "google", medium: "organic" }),
    event({ sessionKey: "s1", visitorKey: "v1", eventType: "custom", eventName: "signup_completed", normalizedPath: "/pricing", props: { plan: "pro" }, source: "google", medium: "organic" }),
    event({ sessionKey: "s1", visitorKey: "v1", eventType: "custom", eventName: "signup_completed", normalizedPath: "/pricing", props: { plan: "pro" }, source: "google", medium: "organic" }),
    event({ sessionKey: "s1", visitorKey: "v1", normalizedPath: "/docs", source: "google", medium: "organic" }),
    // Session 2: same visitor, one page, long enough to be engaged.
    event({ sessionKey: "s2", visitorKey: "v1", normalizedPath: "/docs", deviceType: "mobile" }),
    event({ sessionKey: "s2", visitorKey: "v1", eventType: "engagement", normalizedPath: "/docs", engagedMs: 12_000, deviceType: "mobile" }),
    // Session 3: another visitor, bounces, wrong plan so no signup goal.
    event({ sessionKey: "s3", visitorKey: "v2", normalizedPath: "/", countryCode: null }),
    event({ sessionKey: "s3", visitorKey: "v2", eventType: "custom", eventName: "signup_completed", normalizedPath: "/", props: { plan: "free" }, countryCode: null }),
    // An engagement ping alone does not make a session.
    event({ sessionKey: "s4", visitorKey: "v3", eventType: "engagement", engagedMs: 5000 }),
  ];

  const result = aggregateDay(events, goals, "estimated-daily-unique");

  it("counts pageviews, sessions, visitors and events", () => {
    expect(result.site).toEqual({
      pageviews: 5,
      sessions: 3,
      engagedSessions: 2,
      visitorEstimate: 2,
      eventCount: 3,
      conversions: 3,
      convertingSessions: 1,
    });
  });

  it("counts a session once per goal while keeping every completion", () => {
    const signup = result.goals.find((g) => g.goalId === "signup")!;
    expect([signup.completions, signup.convertingSessions, signup.source]).toEqual([2, 1, "google"]);
    expect(result.goals.find((g) => g.goalId === "pricing")).toMatchObject({ completions: 1, convertingSessions: 1 });
    expect(result.goals.some((g) => g.goalId === "off")).toBe(false);
  });

  it("attributes entries and exits to the first and last page of a session", () => {
    const page = (path: string, device = "desktop") => result.pages.find((p) => p.path === path && p.deviceType === device)!;
    expect([page("/").entries, page("/").exits]).toEqual([2, 1]);
    expect([page("/docs").entries, page("/docs").exits]).toEqual([0, 1]);
    expect([page("/docs", "mobile").entries, page("/docs", "mobile").exits]).toEqual([1, 1]);
    expect(page("/pricing").goalCompletions).toBe(3);
  });

  it("attributes sessions to their first source and labels missing countries", () => {
    expect(result.sources.find((s) => s.source === "google")).toMatchObject({ sessions: 1, pageviews: 3, convertingSessions: 1, referrerDomain: "google.com" });
    expect(result.sources.find((s) => s.source === "(direct)")).toMatchObject({ sessions: 2, pageviews: 2 });
    expect(result.dimensions.find((d) => d.dimension === "country" && d.value === "Unknown")?.pageviews).toBe(1);
  });

  it("reports no visitor figure in strict mode instead of zero", () => {
    const strict = aggregateDay(events.map((e) => ({ ...e, visitorKey: null })), goals, "unavailable");
    expect(strict.site.visitorEstimate).toBeNull();
    expect(strict.site.pageviews).toBe(5);
    expect(strict.pages.every((p) => p.visitorEstimate === null)).toBe(true);
  });

  it("is deterministic regardless of input order", () => {
    expect(aggregateDay([...events].reverse(), goals, "estimated-daily-unique").site).toEqual(result.site);
  });

  it("matches goal rules exactly", () => {
    const pv = { eventType: "pageview" as const, eventName: null, normalizedPath: "/pricing/team", props: {} };
    expect(goalMatchesEvent({ type: "page_visit", match: "exact", path: "/pricing" }, pv)).toBe(false);
    expect(goalMatchesEvent({ type: "page_visit", match: "starts_with", path: "/pricing" }, pv)).toBe(true);
    expect(goalMatchesEvent({ type: "download" }, pv)).toBe(false);
  });
});

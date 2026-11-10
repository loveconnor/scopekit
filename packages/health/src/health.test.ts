import { rateCwv } from "@scopekit/contracts";
import { describe, expect, it } from "vitest";
import { cwvDeterioration, lighthouseRegression, searchClickDrop, trackingStopped } from "./alerts";
import { parseCruxHistory, parseLighthouse } from "./providers";

const base = { siteId: "s1", siteName: "Example" };

describe("alert rules", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const stopped = (hoursAgo: number, activeDaysBefore: number, trackingEnabled = true) =>
    trackingStopped({ ...base, lastEventAt: new Date(now.getTime() - hoursAgo * 3_600_000), lastEventLocalDate: "2026-11-08", activeDaysBefore, trackingEnabled, now });
  it("needs a day of silence and a baseline of traffic", () => {
    expect(stopped(30, 5)?.severity).toBe("critical");
    expect(stopped(23, 5)).toBeNull();
    expect(stopped(30, 2)).toBeNull();
    expect(stopped(30, 5, false)).toBeNull();
    expect(trackingStopped({ ...base, lastEventAt: null, lastEventLocalDate: null, activeDaysBefore: 0, trackingEnabled: true, now })).toBeNull();
  });
  const drop = (current: number, previous: number, days = 7) => searchClickDrop({ ...base, propertyId: "p", current: { clicks: current, days: 7 }, previous: { clicks: previous, days }, window: { from: "2026-10-31", to: "2026-11-06" } });
  it("needs both the share and the absolute drop, over full weeks", () => {
    expect(drop(60, 100)?.type).toBe("search_click_drop");
    expect(drop(71, 100)).toBeNull();
    expect(drop(10, 30)).toBeNull();
    expect(drop(60, 100, 5)).toBeNull();
    expect(drop(0, 0)).toBeNull();
  });
  const runs = (scores: number[], versions = ["12.6.0", "12.6.0", "12.5.1"]) => lighthouseRegression({ ...base, url: "https://example.com/", runs: scores.map((performance, i) => ({ performance, checkedAt: new Date(now.getTime() - i * 86_400_000), lighthouseVersion: versions[i] ?? null })) });
  it("needs two low runs in a row on the same Lighthouse major", () => {
    expect(runs([70, 72, 90])?.evidence.before).toBe(90);
    expect(runs([70, 88, 90])).toBeNull();
    expect(runs([80, 80, 90])).toBeNull();
    expect(runs([70, 72])).toBeNull();
    expect(runs([70, 72, 90], ["13.0.0", "13.0.0", "12.6.0"])).toBeNull();
  });
  it("flags field metrics that move into a worse band only", () => {
    const flat = { lcp: 2000, inp: 150, cls: 0.05 };
    expect(cwvDeterioration({ ...base, periodEnd: "2026-11-08", latest: flat, previous: flat })).toEqual([]);
    const worse = cwvDeterioration({ ...base, periodEnd: "2026-11-08", latest: { lcp: 4200, inp: 250, cls: 0.05 }, previous: flat });
    expect(worse.map((a) => [a.entity, a.severity])).toEqual([["lcp", "critical"], ["inp", "warning"]]);
    expect(cwvDeterioration({ ...base, periodEnd: "2026-11-08", latest: flat, previous: { lcp: 4200, inp: 250, cls: 0.3 } })).toEqual([]);
    expect(cwvDeterioration({ ...base, periodEnd: "2026-11-08", latest: { lcp: null, inp: 150, cls: 0.05 }, previous: flat })).toEqual([]);
  });
  it("uses Google's thresholds", () => {
    expect([rateCwv("lcp", 2500), rateCwv("lcp", 2501), rateCwv("lcp", 4001)]).toEqual(["good", "needs_improvement", "poor"]);
    expect([rateCwv("inp", 200), rateCwv("inp", 501)]).toEqual(["good", "poor"]);
    expect([rateCwv("cls", 0.1), rateCwv("cls", 0.26)]).toEqual(["good", "poor"]);
  });
});

describe("provider parsing", () => {
  it("passes Lighthouse scores through and keeps nothing that was not returned", () => {
    const lab = parseLighthouse({ lighthouseVersion: "12.6.0", categories: { performance: { score: 0.555 }, seo: { score: null } }, audits: { "largest-contentful-paint": { numericValue: 3100.4 }, slow: { title: "Slow thing", score: 0.2, details: { overallSavingsMs: 300 } }, fine: { title: "Fine", score: 1, details: { overallSavingsMs: 900 } }, vague: { title: "No estimate", score: 0.1 }, "final-screenshot": { title: "Shot", score: null } } });
    expect(lab.scores).toEqual({ performance: 56, accessibility: null, bestPractices: null, seo: null });
    expect(lab.metrics.lcp).toBe(3100.4);
    expect(lab.metrics.cls).toBeNull();
    expect(lab.opportunities.map((o) => o.id)).toEqual(["slow"]);
    expect(Object.keys((lab.raw.audits as object) ?? {})).not.toContain("final-screenshot");
  });
  it("drops field periods without values instead of storing zeros", () => {
    const d = (day: number) => ({ year: 2026, month: 10, day });
    const periods = parseCruxHistory({
      collectionPeriods: [{ firstDate: d(1), lastDate: d(28) }, { firstDate: d(8), lastDate: d(30) }],
      metrics: { largest_contentful_paint: { percentilesTimeseries: { p75s: [null, 2100] } }, cumulative_layout_shift: { percentilesTimeseries: { p75s: ["NaN", "0.05"] } } },
    });
    expect(periods).toEqual([{ periodStart: "2026-10-08", periodEnd: "2026-10-30", lcpP75: 2100, inpP75: null, clsP75: 0.05 }]);
  });
});

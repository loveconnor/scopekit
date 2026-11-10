import type { OpportunityEvidence } from "@scopekit/contracts";
import type { DetectedOpportunity, OpportunityPageInput, OpportunityQueryInput } from "@scopekit/db";
import { ctrOf, positionOf } from "./metrics";

/** Every threshold a rule uses, in one place so it can be shown and tuned. */
export const OPPORTUNITY_THRESHOLDS = {
  windowDays: 28,
  lowCtr: { minImpressions: 500, minPosition: 1, maxPosition: 10, margin: 0.3, cohortMinQueries: 5, cohortMinImpressions: 2000 },
  nearPageOne: { minPosition: 4, maxPosition: 20, minImpressions: 200, minWeeks: 3, minPageShare: 0.6 },
  decliningClicks: { minDrop: 0.2, minAbsoluteDrop: 25, newPageGraceDays: 7 },
} as const;
export type OpportunityThresholds = typeof OPPORTUNITY_THRESHOLDS;

export const SCORE_WEIGHTS = { volume: 0.4, gap: 0.35, position: 0.25 } as const;

/**
 * Priority from 0 to 100 for ordering work. It is not a traffic estimate: it only combines
 * how much the subject is seen, how far it is from where comparable results sit, and how
 * much data stands behind that.
 */
export function scoreOf(factors: OpportunityEvidence["factors"]): number {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const blend = SCORE_WEIGHTS.volume * clamp(factors.volume) + SCORE_WEIGHTS.gap * clamp(factors.gap) + SCORE_WEIGHTS.position * clamp(factors.position);
  return Math.round(100 * clamp(factors.confidence) * blend);
}

const logShare = (value: number, max: number) => (max > 0 ? Math.log10(1 + value) / Math.log10(1 + max) : 0);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export type DetectInput = {
  window: { from: string; to: string };
  previousWindow: { from: string; to: string };
  /** Oldest date with stored query and page detail. Rules that compare periods need it to cover both. */
  historyFrom: string | null;
  queries: OpportunityQueryInput[];
  pages: OpportunityPageInput[];
};

export function detectOpportunities(input: DetectInput, thresholds: OpportunityThresholds = OPPORTUNITY_THRESHOLDS): DetectedOpportunity[] {
  const out: DetectedOpportunity[] = [];
  const { lowCtr, nearPageOne, decliningClicks } = thresholds;
  const maxQueryImpressions = Math.max(0, ...input.queries.map((q) => q.impressions));

  // CTR of this site's own queries per rounded position. There is no borrowed industry curve.
  const cohorts = new Map<number, { clicks: number; impressions: number; queries: number }>();
  for (const q of input.queries) {
    const position = positionOf(q);
    if (position === null) continue;
    const bucket = Math.round(position);
    const cohort = cohorts.get(bucket) ?? { clicks: 0, impressions: 0, queries: 0 };
    cohort.clicks += q.clicks;
    cohort.impressions += q.impressions;
    cohort.queries += 1;
    cohorts.set(bucket, cohort);
  }

  for (const q of input.queries) {
    const position = positionOf(q);
    const ctr = ctrOf(q);
    if (position === null || ctr === null) continue;
    const base = { window: input.window, clicks: q.clicks, impressions: q.impressions, ctr, position };

    if (q.impressions >= lowCtr.minImpressions && position >= lowCtr.minPosition && position <= lowCtr.maxPosition + 0.5) {
      const bucket = Math.round(position);
      const cohort = cohorts.get(bucket);
      // The query is compared with the others at its position, not with itself.
      const others = cohort ? { clicks: cohort.clicks - q.clicks, impressions: cohort.impressions - q.impressions, queries: cohort.queries - 1 } : null;
      if (others && others.queries >= lowCtr.cohortMinQueries && others.impressions >= lowCtr.cohortMinImpressions) {
        const cohortCtr = others.clicks / others.impressions;
        if (cohortCtr > 0 && ctr < cohortCtr * (1 - lowCtr.margin)) {
          const factors = {
            volume: logShare(q.impressions, maxQueryImpressions),
            gap: (cohortCtr - ctr) / cohortCtr,
            position: (11 - position) / 10,
            confidence: 0.5 + 0.5 * Math.min(1, q.impressions / (lowCtr.minImpressions * 4)),
          };
          out.push({
            rule: "low_ctr",
            category: "ctr",
            subjectType: "query",
            subject: q.query,
            score: scoreOf(factors),
            evidence: { ...base, cohortCtr, cohortPosition: bucket, page: q.topPage ?? undefined, pageShare: q.topPageShare ?? undefined, factors },
          });
        }
      }
    }

    if (
      position >= nearPageOne.minPosition &&
      position <= nearPageOne.maxPosition &&
      q.impressions >= nearPageOne.minImpressions &&
      q.weeksWithImpressions >= nearPageOne.minWeeks &&
      q.topPage &&
      (q.topPageShare ?? 0) >= nearPageOne.minPageShare
    ) {
      const factors = {
        volume: logShare(q.impressions, maxQueryImpressions),
        gap: 0,
        position: 1 - (position - nearPageOne.minPosition) / (nearPageOne.maxPosition - nearPageOne.minPosition),
        confidence: Math.min(1, q.weeksWithImpressions / 4) * Math.min(1, q.topPageShare ?? 0),
      };
      out.push({
        rule: "near_page_one",
        category: "content",
        subjectType: "query",
        subject: q.query,
        score: scoreOf(factors),
        evidence: { ...base, page: q.topPage, pageShare: q.topPageShare ?? undefined, weeksWithImpressions: q.weeksWithImpressions, factors },
      });
    }
  }

  // Comparing two periods is only fair when both are fully stored.
  if (input.historyFrom && input.historyFrom <= input.previousWindow.from) {
    const maxPageImpressions = Math.max(0, ...input.pages.map((p) => Math.max(p.impressions, p.previousImpressions)));
    for (const p of input.pages) {
      if (p.previousClicks <= 0) continue;
      // A page first seen partway through the earlier period has no full period to compare with.
      if (dayDiff(p.firstSeen, input.previousWindow.from) > decliningClicks.newPageGraceDays) continue;
      const drop = p.previousClicks - p.clicks;
      const share = drop / p.previousClicks;
      if (share <= decliningClicks.minDrop || drop < decliningClicks.minAbsoluteDrop) continue;
      const factors = {
        volume: logShare(Math.max(p.impressions, p.previousImpressions), maxPageImpressions),
        gap: share,
        position: 0,
        confidence: 0.5 + 0.5 * Math.min(1, p.previousClicks / (decliningClicks.minAbsoluteDrop * 8)),
      };
      out.push({
        rule: "declining_clicks",
        category: "content",
        subjectType: "page",
        subject: p.pageUrl,
        score: scoreOf(factors),
        evidence: {
          window: input.window,
          previousWindow: input.previousWindow,
          clicks: p.clicks,
          impressions: p.impressions,
          ctr: p.impressions > 0 ? p.clicks / p.impressions : null,
          position: null,
          previousClicks: p.previousClicks,
          factors,
        },
      });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject));
}

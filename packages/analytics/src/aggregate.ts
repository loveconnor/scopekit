import type { DeviceType, EventType, GoalRules, VisitorMetricMode } from "@scopekit/contracts";
import { matchesPathPattern } from "./normalize";

export type DayEvent = {
  eventType: EventType;
  eventName: string | null;
  occurredAt: Date;
  normalizedPath: string;
  sessionKey: string;
  visitorKey: string | null;
  referrerDomain: string | null;
  source: string;
  medium: string;
  campaign: string | null;
  countryCode: string | null;
  deviceType: DeviceType;
  browserFamily: string;
  props: Record<string, string | number | boolean>;
  engagedMs: number | null;
};

export type GoalDefinition = { id: string; enabled: boolean; rules: GoalRules };

export const ENGAGED_MS_THRESHOLD = 10_000;

export function goalMatchesEvent(rules: GoalRules, event: Pick<DayEvent, "eventType" | "eventName" | "normalizedPath" | "props">): boolean {
  switch (rules.type) {
    case "page_visit":
      if (event.eventType !== "pageview") return false;
      return matchesPathPattern(event.normalizedPath, rules.match === "starts_with" ? `${rules.path}*` : rules.path);
    case "custom_event":
      if (event.eventType !== "custom" || event.eventName !== rules.eventName) return false;
      return Object.entries(rules.props ?? {}).every(([key, value]) => String(event.props[key]) === String(value));
    case "outbound_click":
      return event.eventType === "outbound_click";
    case "download":
      return event.eventType === "download";
  }
}

/** Name an event is cataloged under. Pageviews and engagement pings are not catalog events. */
export function catalogEventName(event: Pick<DayEvent, "eventType" | "eventName">): string | null {
  if (event.eventType === "custom") return event.eventName;
  if (event.eventType === "outbound_click" || event.eventType === "download") return event.eventType;
  return null;
}

type Counter = { pageviews: number; sessions: Set<string>; visitors: Set<string> };
const counter = (): Counter => ({ pageviews: 0, sessions: new Set(), visitors: new Set() });

export type DayAggregates = {
  site: {
    pageviews: number;
    sessions: number;
    engagedSessions: number;
    visitorEstimate: number | null;
    eventCount: number;
    conversions: number;
    convertingSessions: number;
  };
  pages: {
    path: string;
    deviceType: DeviceType;
    pageviews: number;
    sessions: number;
    visitorEstimate: number | null;
    entries: number;
    exits: number;
    goalCompletions: number;
  }[];
  sources: {
    source: string;
    medium: string;
    referrerDomain: string;
    campaign: string;
    sessions: number;
    pageviews: number;
    visitorEstimate: number | null;
    convertingSessions: number;
  }[];
  events: { eventName: string; eventCount: number; sessionCount: number }[];
  dimensions: {
    dimension: "country" | "device" | "browser";
    value: string;
    pageviews: number;
    sessions: number;
    visitorEstimate: number | null;
  }[];
  goals: { goalId: string; source: string; medium: string; completions: number; convertingSessions: number }[];
};

/**
 * Aggregates every non-bot event of one site-local day. Pure and deterministic: running it
 * again over the same events yields the same rows, which is what makes rollups idempotent.
 */
export function aggregateDay(
  events: readonly DayEvent[],
  goals: readonly GoalDefinition[],
  visitorMode: VisitorMetricMode,
): DayAggregates {
  const hasVisitors = visitorMode !== "unavailable";
  const visitorCount = (set: Set<string>) => (hasVisitors ? set.size : null);
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const activeGoals = goals.filter((goal) => goal.enabled);

  type Session = {
    first: DayEvent;
    pageviews: number;
    engagedMs: number;
    firstPage: DayEvent | null;
    lastPage: DayEvent | null;
    goals: Set<string>;
    counted: boolean;
  };
  const sessions = new Map<string, Session>();
  const siteVisitors = new Set<string>();
  const pages = new Map<string, Counter & { path: string; deviceType: DeviceType; entries: number; exits: number; goalCompletions: number }>();
  const eventCatalog = new Map<string, { eventCount: number; sessions: Set<string> }>();
  const dimensions = new Map<string, Counter & { dimension: "country" | "device" | "browser"; value: string }>();
  const goalRows = new Map<string, { goalId: string; source: string; medium: string; completions: number; sessions: Set<string> }>();

  let pageviews = 0;
  let eventCount = 0;
  let conversions = 0;

  // Pass 1: establish each session and its acquisition source (the first event of the day).
  for (const event of ordered) {
    let session = sessions.get(event.sessionKey);
    if (!session) {
      session = { first: event, pageviews: 0, engagedMs: 0, firstPage: null, lastPage: null, goals: new Set(), counted: false };
      sessions.set(event.sessionKey, session);
    }
    if (event.eventType === "engagement") {
      session.engagedMs += event.engagedMs ?? 0;
      continue;
    }
    session.counted = true;
    if (event.visitorKey) siteVisitors.add(event.visitorKey);
  }

  // Pass 2: counts that depend on the session's attributes.
  for (const event of ordered) {
    if (event.eventType === "engagement") continue;
    const session = sessions.get(event.sessionKey)!;

    if (event.eventType === "pageview") {
      pageviews++;
      session.pageviews++;
      session.firstPage ??= event;
      session.lastPage = event;

      const pageKey = `${event.normalizedPath}\u0000${event.deviceType}`;
      let page = pages.get(pageKey);
      if (!page) {
        page = { ...counter(), path: event.normalizedPath, deviceType: event.deviceType, entries: 0, exits: 0, goalCompletions: 0 };
        pages.set(pageKey, page);
      }
      page.pageviews++;
      page.sessions.add(event.sessionKey);
      if (event.visitorKey) page.visitors.add(event.visitorKey);

      const dims: ["country" | "device" | "browser", string][] = [
        ["country", event.countryCode ?? "Unknown"],
        ["device", event.deviceType],
        ["browser", event.browserFamily],
      ];
      for (const [dimension, value] of dims) {
        const key = `${dimension}\u0000${value}`;
        let row = dimensions.get(key);
        if (!row) {
          row = { ...counter(), dimension, value };
          dimensions.set(key, row);
        }
        row.pageviews++;
        row.sessions.add(event.sessionKey);
        if (event.visitorKey) row.visitors.add(event.visitorKey);
      }
    }

    const name = catalogEventName(event);
    if (name) {
      eventCount++;
      let entry = eventCatalog.get(name);
      if (!entry) {
        entry = { eventCount: 0, sessions: new Set() };
        eventCatalog.set(name, entry);
      }
      entry.eventCount++;
      entry.sessions.add(event.sessionKey);
    }

    for (const goal of activeGoals) {
      if (!goalMatchesEvent(goal.rules, event)) continue;
      conversions++;
      session.goals.add(goal.id);
      const key = `${goal.id}\u0000${session.first.source}\u0000${session.first.medium}`;
      let row = goalRows.get(key);
      if (!row) {
        row = { goalId: goal.id, source: session.first.source, medium: session.first.medium, completions: 0, sessions: new Set() };
        goalRows.set(key, row);
      }
      row.completions++;
      row.sessions.add(event.sessionKey);
      const page = pages.get(`${event.normalizedPath}\u0000${event.deviceType}`);
      if (page) page.goalCompletions++;
    }
  }

  // Pass 3: per-session rollups.
  const sources = new Map<
    string,
    Counter & { source: string; medium: string; referrerDomain: string; campaign: string; converting: number }
  >();
  let sessionCount = 0;
  let engagedSessions = 0;
  let convertingSessions = 0;
  for (const [sessionKey, session] of sessions) {
    if (!session.counted) continue;
    sessionCount++;
    const converted = session.goals.size > 0;
    if (converted) convertingSessions++;
    if (session.engagedMs >= ENGAGED_MS_THRESHOLD || session.pageviews >= 2 || converted) engagedSessions++;

    if (session.firstPage) pages.get(`${session.firstPage.normalizedPath}\u0000${session.firstPage.deviceType}`)!.entries++;
    if (session.lastPage) pages.get(`${session.lastPage.normalizedPath}\u0000${session.lastPage.deviceType}`)!.exits++;

    const { source, medium } = session.first;
    const referrerDomain = session.first.referrerDomain ?? "";
    const campaign = session.first.campaign ?? "";
    const key = [source, medium, referrerDomain, campaign].join("\u0000");
    let row = sources.get(key);
    if (!row) {
      row = { ...counter(), source, medium, referrerDomain, campaign, converting: 0 };
      sources.set(key, row);
    }
    row.sessions.add(sessionKey);
    row.pageviews += session.pageviews;
    if (session.first.visitorKey) row.visitors.add(session.first.visitorKey);
    if (converted) row.converting++;
  }

  return {
    site: {
      pageviews,
      sessions: sessionCount,
      engagedSessions,
      visitorEstimate: visitorCount(siteVisitors),
      eventCount,
      conversions,
      convertingSessions,
    },
    pages: [...pages.values()].map((p) => ({
      path: p.path,
      deviceType: p.deviceType,
      pageviews: p.pageviews,
      sessions: p.sessions.size,
      visitorEstimate: visitorCount(p.visitors),
      entries: p.entries,
      exits: p.exits,
      goalCompletions: p.goalCompletions,
    })),
    sources: [...sources.values()].map((s) => ({
      source: s.source,
      medium: s.medium,
      referrerDomain: s.referrerDomain,
      campaign: s.campaign,
      sessions: s.sessions.size,
      pageviews: s.pageviews,
      visitorEstimate: visitorCount(s.visitors),
      convertingSessions: s.converting,
    })),
    events: [...eventCatalog.entries()].map(([eventName, e]) => ({
      eventName,
      eventCount: e.eventCount,
      sessionCount: e.sessions.size,
    })),
    dimensions: [...dimensions.values()].map((d) => ({
      dimension: d.dimension,
      value: d.value,
      pageviews: d.pageviews,
      sessions: d.sessions.size,
      visitorEstimate: visitorCount(d.visitors),
    })),
    goals: [...goalRows.values()].map((g) => ({
      goalId: g.goalId,
      source: g.source,
      medium: g.medium,
      completions: g.completions,
      convertingSessions: g.sessions.size,
    })),
  };
}

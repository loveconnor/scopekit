import { METRIC_DEFINITIONS_VERSION } from "@scopekit/contracts";

export type MetricDefinition = { label: string; definition: string; caveat: string };

/** One vocabulary for the whole product. The UI reads its help text from here. */
export const METRIC_DEFINITIONS = {
  pageviews: {
    label: "Pageviews",
    definition: "Accepted pageview events from the ScopeKit script, bots excluded.",
    caveat: "Script blockers and consent choices reduce the count.",
  },
  sessions: {
    label: "Sessions",
    definition: "Distinct tab sessions with at least one pageview or event, counted per local day and summed over the range.",
    caveat: "A new tab starts a new session, and a session that crosses midnight counts on both days.",
  },
  visitors: {
    label: "Visitors",
    definition: "Estimated unique devices per site per day, summed over the range.",
    caveat: "Not unique people, not unique across days, and never combined across sites.",
  },
  summedSiteVisitors: {
    label: "Summed site visitors",
    definition: "Each site's daily visitor estimates added together.",
    caveat: "Someone who visits two sites counts twice. ScopeKit never matches visitors across sites.",
  },
  engagedSessions: {
    label: "Engaged sessions",
    definition: "Sessions with 10 seconds of visible time, two or more pageviews, or a goal completion.",
    caveat: "Not comparable with GA4 engaged sessions.",
  },
  pagesPerSession: {
    label: "Pages / session",
    definition: "Pageviews divided by sessions.",
    caveat: "Not shown when there are no sessions.",
  },
  events: {
    label: "Events",
    definition: "Accepted custom events, outbound clicks and downloads.",
    caveat: "Browser events are not authoritative purchase or signup records.",
  },
  conversions: {
    label: "Goal completions",
    definition: "Events that matched an enabled goal. One session can complete a goal several times.",
    caveat: "Goals created later are backfilled only as far as raw events are retained.",
  },
  conversionRate: {
    label: "Conversion rate",
    definition: "Sessions with at least one goal completion divided by all sessions in the range.",
    caveat: "A session counts once however many goals it completes.",
  },
  entries: {
    label: "Entries",
    definition: "Sessions whose first pageview of the day was this page.",
    caveat: "Per local day.",
  },
  exits: {
    label: "Exits",
    definition: "Sessions whose last pageview of the day was this page.",
    caveat: "Per local day.",
  },
  activeSessions: {
    label: "Active sessions",
    definition: "Sessions with an accepted event in the last five minutes.",
    caveat: "Approximate. Not an exact count of people on the site right now.",
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;
export { METRIC_DEFINITIONS_VERSION };

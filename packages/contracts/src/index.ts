import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Shared vocabulary                                                          */
/* -------------------------------------------------------------------------- */

export const EVENT_PROTOCOL_VERSION = 1;
export const METRIC_DEFINITIONS_VERSION = 1;

export const EVENT_TYPES = ["pageview", "custom", "engagement", "outbound_click", "download"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PRIVACY_MODES = ["default", "strict", "consent"] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

/** How the visitor figure for a site was produced. Shown next to every visitor metric. */
export const VISITOR_METRIC_MODES = {
  default: "estimated-daily-unique",
  strict: "unavailable",
  consent: "first-party-id",
} as const satisfies Record<PrivacyMode, string>;
export type VisitorMetricMode = (typeof VISITOR_METRIC_MODES)[PrivacyMode];

export const SITE_STATUSES = ["pending_setup", "active", "disabled"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const GOAL_TYPES = ["page_visit", "custom_event", "outbound_click", "download"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const DEVICE_TYPES = ["desktop", "mobile", "tablet", "unknown"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const DATA_SOURCES = ["scopekit", "gsc", "lighthouse", "crux"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/* -------------------------------------------------------------------------- */
/* Collection payload (browser -> collector)                                  */
/* -------------------------------------------------------------------------- */

export const COLLECT_LIMITS = {
  maxBodyBytes: 10 * 1024,
  maxStringLength: 1024,
  maxPropKeys: 10,
  maxBatch: 20,
  /** Events older than this are rejected instead of being backdated. */
  maxPastSkewMs: 48 * 60 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
} as const;

const shortString = z.string().max(200);
const eventName = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);

export const collectEventSchema = z.object({
  v: z.literal(EVENT_PROTOCOL_VERSION),
  site: z.string().regex(/^sk_site_[A-Za-z0-9]{8,40}$/),
  id: z.uuid(),
  type: z.enum(EVENT_TYPES),
  name: eventName.optional(),
  occurredAt: z.iso.datetime(),
  path: z.string().min(1).max(COLLECT_LIMITS.maxStringLength).startsWith("/"),
  referrer: z.string().max(COLLECT_LIMITS.maxStringLength).nullish(),
  utm: z
    .object({
      source: shortString.nullish(),
      medium: shortString.nullish(),
      campaign: shortString.nullish(),
    })
    .nullish(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** Only honored when the site runs in consent mode. */
  visitorId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullish(),
  /** Visible time since the last report, for engagement events. */
  engagedMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullish(),
  /** Validated and sanitized separately so one bad key does not drop the event. */
  props: z.record(z.string(), z.unknown()).nullish(),
});
export type CollectEvent = z.infer<typeof collectEventSchema>;

/** What the collector puts on the queue after deriving trusted fields. Never contains an IP or user agent. */
export type QueuedEvent = {
  id: string;
  siteId: string;
  eventType: EventType;
  eventName: string | null;
  occurredAt: string;
  receivedAt: string;
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
  botFlag: boolean;
};

export const INGEST_QUEUE = "scopekit-ingest";
export const MAINTENANCE_QUEUE = "scopekit-maintenance";

/* -------------------------------------------------------------------------- */
/* Dashboard API                                                              */
/* -------------------------------------------------------------------------- */

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
};

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(localhost|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(:\d{2,5})?$/, "Enter a hostname like example.com");

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown timezone");

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  url: z.string().trim().min(1, "URL is required").max(300),
  timezone,
  privacyMode: z.enum(PRIVACY_MODES).default("default"),
});
export type CreateSiteInput = z.infer<typeof createSiteSchema>;

const pathPattern = z.string().trim().startsWith("/").max(200);

export const updateSiteSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone,
    privacyMode: z.enum(PRIVACY_MODES),
    trackingEnabled: z.boolean(),
    geolocationEnabled: z.boolean(),
    retentionDays: z.number().int().min(7).max(730),
    allowedQueryParams: z.array(z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/)).max(20),
    excludedPathPatterns: z.array(pathPattern).max(50),
    aliases: z.array(hostname).max(10),
  })
  .partial();
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

export const goalRulesSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("page_visit"),
    match: z.enum(["exact", "starts_with"]),
    path: pathPattern,
  }),
  z.object({
    type: z.literal("custom_event"),
    eventName,
    /** Every listed property must equal the given value. */
    props: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
  }),
  z.object({ type: z.literal("outbound_click") }),
  z.object({ type: z.literal("download") }),
]);
export type GoalRules = z.infer<typeof goalRulesSchema>;

export const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  rules: goalRulesSchema,
});
export const updateGoalSchema = z
  .object({ name: z.string().trim().min(1).max(80), enabled: z.boolean(), rules: goalRulesSchema })
  .partial();

export const RANGE_PRESETS = ["today", "24h", "7d", "30d", "90d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const FILTER_DIMENSIONS = ["page", "referrer", "source", "medium", "campaign", "country", "device", "browser"] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];
/** AND across dimensions, OR across the values of one dimension. */
export type AnalyticsFilters = Partial<Record<FilterDimension, string[]>>;

/** Envelope that every aggregate response carries (spec 14.1). */
export type AggregateMeta = {
  source: DataSource;
  freshThrough: string | null;
  isPartial: boolean;
  metricDefinitionsVersion: number;
};

/* -------------------------------------------------------------------------- */
/* Search Console                                                             */
/* -------------------------------------------------------------------------- */

export const SEO_QUEUE = "scopekit-seo";

/** Search Console reports dates in Pacific Time, whatever the site's own timezone is. */
export const GSC_TIMEZONE = "America/Los_Angeles";
/** Search Console keeps roughly 16 months of history. */
export const GSC_MAX_HISTORY_DAYS = 486;
export const GSC_SEARCH_TYPE = "web";

export const CONNECTION_STATUSES = ["connected", "needs_reauth"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const PROPERTY_SYNC_STATUSES = ["idle", "syncing", "rate_limited", "error"] as const;
export type PropertySyncStatus = (typeof PROPERTY_SYNC_STATUSES)[number];

export const GSC_PROPERTY_TYPES = ["domain", "url_prefix"] as const;
export type GscPropertyType = (typeof GSC_PROPERTY_TYPES)[number];

export const OPPORTUNITY_RULES = ["low_ctr", "near_page_one", "declining_clicks"] as const;
export type OpportunityRule = (typeof OPPORTUNITY_RULES)[number];

export const OPPORTUNITY_CATEGORIES = ["ctr", "content", "technical", "performance"] as const;
export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

export const OPPORTUNITY_STATUSES = ["new", "in_progress", "dismissed", "resolved"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** Figures an opportunity was detected from. Stored with it so the evidence never drifts from the claim. */
export type OpportunityEvidence = {
  window: { from: string; to: string };
  previousWindow?: { from: string; to: string };
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  /** CTR of this site's other queries at the same rounded position. */
  cohortCtr?: number;
  cohortPosition?: number;
  previousClicks?: number;
  /** Page that receives most of the query's impressions. */
  page?: string;
  pageShare?: number;
  weeksWithImpressions?: number;
  /** Score inputs, each 0 to 1, so the formula can be shown next to the result. */
  factors: { volume: number; gap: number; position: number; confidence: number };
};

export const linkPropertySchema = z.object({
  integrationId: z.uuid(),
  property: z.string().min(4).max(500),
  /** Required when the property's hostname is not one of the site's hostnames. */
  confirmMismatch: z.boolean().optional(),
});

export const updateOpportunitySchema = z.object({ status: z.enum(OPPORTUNITY_STATUSES) });

export const inspectUrlSchema = z.object({ url: z.url().max(2000), propertyId: z.uuid().optional() });

/* -------------------------------------------------------------------------- */
/* Site audit                                                                 */
/* -------------------------------------------------------------------------- */

export const AUDIT_QUEUE = "scopekit-audit";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ISSUE_STATES = ["open", "resolved", "ignored", "snoozed"] as const;
export type IssueState = (typeof ISSUE_STATES)[number];

export const CRAWL_STATUSES = ["queued", "running", "cancelling", "done", "partial", "cancelled", "error"] as const;
export type CrawlStatus = (typeof CRAWL_STATUSES)[number];

export const CRAWL_SCHEDULES = ["weekly", "daily", "off"] as const;
export type CrawlSchedule = (typeof CRAWL_SCHEDULES)[number];

/** Why a crawl stopped before visiting everything it found. */
export type CrawlStopReason = "page_limit" | "cancelled" | "error_budget" | "time_limit" | null;

export type CrawlSummary = {
  open: Record<Severity, number>;
  newIssues: number;
  resolvedIssues: number;
  /** 0 to 100 for a complete crawl, null when coverage is insufficient. */
  score: number | null;
  scoreVersion: number;
  eligiblePages: number;
  stopReason: CrawlStopReason;
  sitemaps: { url: string; ok: boolean; urls: number; error?: string }[];
  robots: { found: boolean; status: number | null };
};

export const updateIssueSchema = z.object({
  state: z.enum(["open", "ignored", "snoozed"]),
  /** ISO date, required for snoozed. */
  until: z.iso.date().optional(),
  reason: z.string().trim().max(200).optional(),
});

export const updateAuditRuleSchema = z.object({
  ruleId: z.string().regex(/^[A-Z0-9_]{3,40}$/),
  enabled: z.boolean().optional(),
  severity: z.enum(SEVERITIES).nullable().optional(),
});

export const crawlSettingsSchema = z
  .object({
    maxPages: z.number().int().min(10).max(5000),
    crawlSchedule: z.enum(CRAWL_SCHEDULES),
    sitemapUrl: z.union([z.url().max(500), z.literal("")]),
    crawlExcludedPaths: z.array(z.string().trim().startsWith("/").max(200)).max(50),
  })
  .partial();

export const recheckPageSchema = z.object({ url: z.url().max(2000) });

/* -------------------------------------------------------------------------- */
/* Performance, alerts, annotations                                           */
/* -------------------------------------------------------------------------- */

export const PERF_DEVICES = ["mobile", "desktop"] as const;
export type PerfDevice = (typeof PERF_DEVICES)[number];

export type LabScores = { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null };
/** Lab timings in milliseconds; CLS is unitless. */
export type LabMetrics = { fcp: number | null; lcp: number | null; speedIndex: number | null; tbt: number | null; cls: number | null };
export type LabOpportunity = { id: string; title: string; savingsMs: number | null; savingsBytes: number | null };

export const CRUX_FORM_FACTORS = ["PHONE", "DESKTOP"] as const;
export type CruxFormFactor = (typeof CRUX_FORM_FACTORS)[number];

/** Core Web Vitals thresholds at the 75th percentile (Google's published values). */
export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const;
export type CwvMetric = keyof typeof CWV_THRESHOLDS;
export type CwvRating = "good" | "needs_improvement" | "poor";
export const rateCwv = (metric: CwvMetric, value: number): CwvRating =>
  value <= CWV_THRESHOLDS[metric].good ? "good" : value > CWV_THRESHOLDS[metric].poor ? "poor" : "needs_improvement";

export const runPerformanceSchema = z.object({ url: z.url().max(2000).optional(), device: z.enum(PERF_DEVICES).optional() });
export const performanceSettingsSchema = z.object({ performanceUrls: z.array(z.url().max(2000)).max(10) });

export const ALERT_TYPES = [
  "tracking_stopped",
  "search_click_drop",
  "new_critical_issue",
  "lighthouse_regression",
  "cwv_deterioration",
  "integration_disconnected",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved", "snoozed"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export type AlertSeverity = "critical" | "warning";

/** Figures an alert was raised from, shown with it. */
export type AlertEvidence = Record<string, string | number | boolean | null>;

export const updateAlertSchema = z.object({ status: z.enum(ALERT_STATUSES), until: z.iso.date().optional() });
export const updateAlertRuleSchema = z.object({ type: z.enum(ALERT_TYPES), enabled: z.boolean().optional(), email: z.boolean().optional() });

export const ANNOTATION_TYPES = ["deployment", "content", "migration", "custom"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const createAnnotationSchema = z.object({
  date: z.iso.date(),
  type: z.enum(ANNOTATION_TYPES),
  title: z.string().trim().min(1, "Title is required").max(120),
  note: z.string().trim().max(500).optional(),
  linkedUrl: z.union([z.url().max(500), z.literal("")]).optional(),
  commitSha: z.union([z.string().regex(/^[0-9a-f]{7,40}$/i, "Use a 7 to 40 character commit SHA"), z.literal("")]).optional(),
});

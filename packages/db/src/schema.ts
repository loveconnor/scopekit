import type {
  AlertEvidence,
  AlertSeverity,
  AlertStatus,
  AlertType,
  AnnotationType,
  ConnectionStatus,
  CrawlSchedule,
  CrawlStatus,
  CrawlSummary,
  CruxFormFactor,
  IssueState,
  LabMetrics,
  LabOpportunity,
  LabScores,
  PerfDevice,
  Severity,
  GoalRules,
  GscPropertyType,
  OpportunityCategory,
  OpportunityEvidence,
  OpportunityRule,
  OpportunityStatus,
  PrivacyMode,
  PropertySyncStatus,
  SiteStatus,
  VisitorMetricMode,
} from "@scopekit/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ----------------------------------------------------------------------------
 * Auth (managed by Better Auth). One allowlisted owner; no public signup.
 * ------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").$type<"system" | "light" | "dark">().notNull().default("system"),
  defaultRange: text("default_range").$type<"7d" | "30d" | "90d">().notNull().default("30d"),
  lastSiteId: uuid("last_site_id"),
  updatedAt: updatedAt(),
});

/* ----------------------------------------------------------------------------
 * Sites (control plane)
 * ------------------------------------------------------------------------- */

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    canonicalOrigin: text("canonical_origin").notNull(),
    timezone: text("timezone").notNull(),
    faviconUrl: text("favicon_url"),
    status: text("status").$type<SiteStatus>().notNull().default("pending_setup"),
    privacyMode: text("privacy_mode").$type<PrivacyMode>().notNull().default("default"),
    /** Synthetic site created by `npm run demo:seed`. Hidden unless SCOPEKIT_DEMO=1. */
    isDemo: boolean("is_demo").notNull().default(false),
    firstEventAt: timestamp("first_event_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("sites_live_idx").on(t.createdAt).where(sql`${t.deletedAt} is null`)],
);

export const siteDomains = pgTable(
  "site_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationMethod: text("verification_method").$type<"owner_confirmation" | "dns_txt" | "html_file">(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  // A hostname belongs to exactly one site, so events can never be ambiguous.
  (t) => [uniqueIndex("site_domains_hostname_key").on(t.hostname), index("site_domains_site_idx").on(t.siteId)],
);

export const siteSettings = pgTable("site_settings", {
  siteId: uuid("site_id")
    .primaryKey()
    .references(() => sites.id, { onDelete: "cascade" }),
  allowedQueryParams: jsonb("allowed_query_params").$type<string[]>().notNull().default([]),
  excludedPathPatterns: jsonb("excluded_path_patterns").$type<string[]>().notNull().default([]),
  maxPages: integer("max_pages").notNull().default(500),
  crawlSchedule: text("crawl_schedule").$type<CrawlSchedule>().notNull().default("weekly"),
  /** Extra sitemap to read besides the ones robots.txt lists. */
  sitemapUrl: text("sitemap_url"),
  crawlExcludedPaths: jsonb("crawl_excluded_paths").$type<string[]>().notNull().default([]),
  /** Pages checked weekly with Lighthouse besides the homepage. */
  performanceUrls: jsonb("performance_urls").$type<string[]>().notNull().default([]),
  /** Whether Chrome has enough real-user data for the origin, per form factor, and when that was last asked. */
  cruxStatus: jsonb("crux_status").$type<{ checkedAt: string; PHONE: "ok" | "no_data" | "error"; DESKTOP: "ok" | "no_data" | "error" }>(),
  trackingEnabled: boolean("tracking_enabled").notNull().default(true),
  geolocationEnabled: boolean("geolocation_enabled").notNull().default(true),
  retentionDays: integer("retention_days").notNull().default(90),
  version: integer("version").notNull().default(1),
  updatedAt: updatedAt(),
});

export const siteCredentials = pgTable(
  "site_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Public by design: it ships in every page of the tracked site. Never treat it as a secret. */
    publicTrackingId: text("public_tracking_id").notNull().unique(),
    createdAt: createdAt(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("site_credentials_site_idx").on(t.siteId)],
);

/* ----------------------------------------------------------------------------
 * Events and rollups
 * ------------------------------------------------------------------------- */

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").notNull(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventName: text("event_name"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    normalizedPath: text("normalized_path").notNull(),
    sessionKey: text("session_key").notNull(),
    /** Daily-rotating HMAC in default mode, hashed first-party ID in consent mode, null in strict mode. */
    visitorKey: text("visitor_key"),
    referrerDomain: text("referrer_domain"),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    campaign: text("campaign"),
    countryCode: text("country_code"),
    deviceType: text("device_type").notNull(),
    browserFamily: text("browser_family").notNull(),
    props: jsonb("props").$type<Record<string, string | number | boolean>>().notNull().default({}),
    engagedMs: integer("engaged_ms"),
    botFlag: boolean("bot_flag").notNull().default(false),
    schemaVersion: integer("schema_version").notNull().default(1),
  },
  (t) => [
    // Durable dedupe: a retried event ID can never be stored, or counted, twice.
    primaryKey({ columns: [t.siteId, t.id] }),
    index("analytics_events_site_time_idx").on(t.siteId, t.occurredAt.desc()),
  ],
);

/** Salts for the daily visitor estimate. Rows are deleted two days after their date. */
export const visitorSalts = pgTable("visitor_salts", {
  localDate: date("local_date").primaryKey(),
  salt: text("salt").notNull(),
  createdAt: createdAt(),
});

/** Site-local days whose rollups need recomputing from raw events. */
export const aggregationDirty = pgTable(
  "aggregation_dirty",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.localDate] })],
);

const siteDay = () => ({
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  localDate: date("local_date").notNull(),
});

export const siteDailyMetrics = pgTable(
  "site_daily_metrics",
  {
    ...siteDay(),
    visitorMode: text("visitor_mode").$type<VisitorMetricMode>().notNull(),
    pageviews: integer("pageviews").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    engagedSessions: integer("engaged_sessions").notNull().default(0),
    visitorEstimate: integer("visitor_estimate"),
    eventCount: integer("event_count").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    convertingSessions: integer("converting_sessions").notNull().default(0),
    /** Newest `received_at` included in this row. */
    dataWatermark: timestamp("data_watermark", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.localDate] })],
);

export const pageDailyMetrics = pgTable(
  "page_daily_metrics",
  {
    ...siteDay(),
    normalizedPath: text("normalized_path").notNull(),
    deviceType: text("device_type").notNull(),
    pageviews: integer("pageviews").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    visitorEstimate: integer("visitor_estimate"),
    entries: integer("entries").notNull().default(0),
    exits: integer("exits").notNull().default(0),
    goalCompletions: integer("goal_completions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.localDate, t.normalizedPath, t.deviceType] })],
);

export const sourceDailyMetrics = pgTable(
  "source_daily_metrics",
  {
    ...siteDay(),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    referrerDomain: text("referrer_domain").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    sessions: integer("sessions").notNull().default(0),
    pageviews: integer("pageviews").notNull().default(0),
    visitorEstimate: integer("visitor_estimate"),
    convertingSessions: integer("converting_sessions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.localDate, t.source, t.medium, t.referrerDomain, t.campaign] })],
);

export const eventDailyMetrics = pgTable(
  "event_daily_metrics",
  {
    ...siteDay(),
    eventName: text("event_name").notNull(),
    eventCount: integer("event_count").notNull().default(0),
    sessionCount: integer("session_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.localDate, t.eventName] })],
);

/** Country, device and browser breakdowns in one narrow table. */
export const dimensionDailyMetrics = pgTable(
  "dimension_daily_metrics",
  {
    ...siteDay(),
    dimension: text("dimension").$type<"country" | "device" | "browser">().notNull(),
    value: text("value").notNull(),
    pageviews: integer("pageviews").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    visitorEstimate: integer("visitor_estimate"),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.localDate, t.dimension, t.value] })],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    matchingRules: jsonb("matching_rules").$type<GoalRules>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_site_idx").on(t.siteId)],
);

export const goalDailyMetrics = pgTable(
  "goal_daily_metrics",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    ...siteDay(),
    source: text("source").notNull(),
    medium: text("medium").notNull(),
    completions: integer("completions").notNull().default(0),
    convertingSessions: integer("converting_sessions").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.goalId, t.localDate, t.source, t.medium] }),
    index("goal_daily_site_idx").on(t.siteId, t.localDate),
  ],
);

/* ----------------------------------------------------------------------------
 * Operations
 * ------------------------------------------------------------------------- */

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: text("job_type").notNull(),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
    status: text("status").$type<"running" | "done" | "error" | "cancelled">().notNull(),
    attempts: integer("attempts").notNull().default(1),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
  },
  (t) => [index("job_runs_started_idx").on(t.startedAt.desc())],
);

/** High-risk changes only. Metadata is bounded and never holds secrets or visitor data. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id"),
    siteId: uuid("site_id"),
    entity: text("entity").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_at_idx").on(t.at.desc())],
);

/* ----------------------------------------------------------------------------
 * Search Console
 * ------------------------------------------------------------------------- */

/** One authorized Google account. Tokens are envelope-encrypted; nothing here is readable without the master key. */
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null only for the synthetic demo connection. */
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"google">().notNull(),
  accountLabel: text("account_label").notNull(),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  connectionStatus: text("connection_status").$type<ConnectionStatus>().notNull().default("connected"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

/**
 * A Search Console property linked to a site. Its `id` is the `property_id` on every GSC
 * table, so a domain property and a URL-prefix property for the same site never mix.
 */
export const siteIntegrations = pgTable(
  "site_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    externalPropertyId: text("external_property_id").notNull(),
    externalPropertyType: text("external_property_type").$type<GscPropertyType>().notNull(),
    permissionLevel: text("permission_level"),
    enabled: boolean("enabled").notNull().default(true),
    /** Oldest date the backfill aims for (Pacific Time, like every GSC date). */
    backfillTarget: date("backfill_target"),
    /** Query and page detail is stored from this date onwards. Null until the first sync. */
    oldestSyncedDate: date("oldest_synced_date"),
    /** Newest date Google reports as final. */
    finalizedThrough: date("finalized_through"),
    syncStatus: text("sync_status").$type<PropertySyncStatus>().notNull().default("idle"),
    /** When the worker should sync next. Null means never (demo data). */
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    syncHeartbeatAt: timestamp("sync_heartbeat_at", { withTimezone: true }),
    failureStreak: integer("failure_streak").notNull().default(0),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("site_integrations_site_property_key").on(t.siteId, t.externalPropertyId),
    index("site_integrations_due_idx").on(t.nextSyncAt),
  ],
);

const gscDay = () => ({
  propertyId: uuid("property_id")
    .notNull()
    .references(() => siteIntegrations.id, { onDelete: "cascade" }),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  searchType: text("search_type").notNull(),
});
const gscMetrics = () => ({
  clicks: integer("clicks").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  /** Sum of position x impressions, so average position is always impression-weighted. */
  positionNumerator: doublePrecision("position_numerator").notNull().default(0),
});

/** Property totals, requested on their own. Never derived by summing query or page rows. */
export const gscSiteDaily = pgTable(
  "gsc_site_daily",
  {
    ...gscDay(),
    aggregationType: text("aggregation_type").notNull(),
    ...gscMetrics(),
    finalized: boolean("finalized").notNull().default(true),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.date, t.searchType, t.aggregationType] })],
);

/** `country` and `device` are empty when the row was retrieved without that dimension. */
export const gscQueryDaily = pgTable(
  "gsc_query_daily",
  {
    ...gscDay(),
    query: text("query").notNull(),
    country: text("country").notNull().default(""),
    device: text("device").notNull().default(""),
    ...gscMetrics(),
    dataState: text("data_state").notNull().default("final"),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.date, t.searchType, t.query, t.country, t.device] })],
);

export const gscPageDaily = pgTable(
  "gsc_page_daily",
  {
    ...gscDay(),
    pageUrl: text("page_url").notNull(),
    country: text("country").notNull().default(""),
    device: text("device").notNull().default(""),
    ...gscMetrics(),
    dataState: text("data_state").notNull().default("final"),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.date, t.searchType, t.pageUrl, t.country, t.device] })],
);

/** Top query and page pairs per day. Capped on purpose: this is detail, not a total. */
export const gscQueryPageDaily = pgTable(
  "gsc_query_page_daily",
  {
    ...gscDay(),
    query: text("query").notNull(),
    pageUrl: text("page_url").notNull(),
    ...gscMetrics(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.date, t.searchType, t.query, t.pageUrl] }),
    index("gsc_query_page_page_idx").on(t.propertyId, t.pageUrl, t.date),
  ],
);

/** Property totals split by one dimension at a time. */
export const gscSegmentDaily = pgTable(
  "gsc_segment_daily",
  {
    ...gscDay(),
    dimension: text("dimension").$type<"device" | "country">().notNull(),
    value: text("value").notNull(),
    ...gscMetrics(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.date, t.searchType, t.dimension, t.value] })],
);

export const gscSyncRuns = pgTable(
  "gsc_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => siteIntegrations.id, { onDelete: "cascade" }),
    profile: text("profile").$type<"first" | "incremental" | "backfill">().notNull(),
    fromDate: date("from_date"),
    toDate: date("to_date"),
    rowCount: integer("row_count").notNull().default(0),
    requestCount: integer("request_count").notNull().default(0),
    status: text("status").$type<"running" | "done" | "partial" | "rate_limited" | "needs_reauth" | "error">().notNull(),
    error: text("error"),
    /** A day returned as many rows as we asked for, so its long tail may be cut off. */
    truncated: boolean("truncated").notNull().default(false),
    quotaLimited: boolean("quota_limited").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("gsc_sync_runs_site_idx").on(t.siteId, t.startedAt.desc())],
);

/** Each check is kept, so a change in Google's indexed state stays visible. */
export const urlInspections = pgTable(
  "url_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => siteIntegrations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    indexVerdict: text("index_verdict"),
    coverageState: text("coverage_state"),
    crawledAs: text("crawled_as"),
    googleCanonical: text("google_canonical"),
    userCanonical: text("user_canonical"),
    lastCrawlAt: timestamp("last_crawl_at", { withTimezone: true }),
    robotsTxtState: text("robots_txt_state"),
    indexingState: text("indexing_state"),
    pageFetchState: text("page_fetch_state"),
    inspectionLink: text("inspection_link"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (t) => [index("url_inspections_site_url_idx").on(t.siteId, t.url, t.checkedAt.desc())],
);

export const seoOpportunities = pgTable(
  "seo_opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => siteIntegrations.id, { onDelete: "cascade" }),
    rule: text("rule").$type<OpportunityRule>().notNull(),
    category: text("category").$type<OpportunityCategory>().notNull(),
    subjectType: text("subject_type").$type<"query" | "page">().notNull(),
    subject: text("subject").notNull(),
    status: text("status").$type<OpportunityStatus>().notNull().default("new"),
    /** Priority for ordering work, 0 to 100. Not a traffic estimate. */
    score: integer("score").notNull(),
    evidence: jsonb("evidence").$type<OpportunityEvidence>().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("seo_opportunities_subject_key").on(t.propertyId, t.rule, t.subject),
    index("seo_opportunities_site_idx").on(t.siteId, t.status),
  ],
);

/* ----------------------------------------------------------------------------
 * Site audit
 * ------------------------------------------------------------------------- */

export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** A full crawl, or a fresh look at one page. */
    kind: text("kind").$type<"full" | "recheck">().notNull().default("full"),
    targetUrl: text("target_url"),
    trigger: text("trigger").$type<"manual" | "scheduled" | "demo">().notNull().default("manual"),
    status: text("status").$type<CrawlStatus>().notNull().default("queued"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    maxPages: integer("max_pages").notNull(),
    pagesDiscovered: integer("pages_discovered").notNull().default(0),
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    /** Every discovered in-scope URL was visited. Only then can absence of an issue mean it is fixed. */
    coverageComplete: boolean("coverage_complete").notNull().default(false),
    errorSummary: text("error_summary"),
    configHash: text("config_hash"),
    crawlerVersion: integer("crawler_version").notNull().default(1),
    summary: jsonb("summary").$type<CrawlSummary>(),
  },
  (t) => [index("crawl_runs_site_idx").on(t.siteId, t.queuedAt.desc()), index("crawl_runs_status_idx").on(t.status)],
);

export const crawlPages = pgTable(
  "crawl_pages",
  {
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    statusCode: integer("status_code"),
    /** Set when the request never produced a response (timeout, DNS, blocked address). */
    fetchError: text("fetch_error"),
    redirectHops: integer("redirect_hops").notNull().default(0),
    contentType: text("content_type"),
    responseMs: integer("response_ms"),
    robotsBlocked: boolean("robots_blocked").notNull().default(false),
    inSitemap: boolean("in_sitemap").notNull().default(false),
    indexable: boolean("indexable").notNull().default(false),
    title: text("title"),
    metaDescription: text("meta_description"),
    canonical: text("canonical"),
    robotsMeta: text("robots_meta"),
    h1: text("h1"),
    h1Count: integer("h1_count"),
    wordCount: integer("word_count"),
    internalInlinkCount: integer("internal_inlink_count").notNull().default(0),
    internalOutlinkCount: integer("internal_outlink_count").notNull().default(0),
    issueCount: integer("issue_count").notNull().default(0),
    htmlHash: text("html_hash"),
    depth: integer("depth"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.crawlRunId, t.url] }), index("crawl_pages_site_idx").on(t.siteId)],
);

export const crawlLinks = pgTable(
  "crawl_links",
  {
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    targetUrl: text("target_url").notNull(),
    linkType: text("link_type").$type<"internal" | "canonical" | "redirect">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.crawlRunId, t.sourceUrl, t.targetUrl, t.linkType] }), index("crawl_links_target_idx").on(t.crawlRunId, t.targetUrl)],
);

/** Per-site exceptions to the rule catalog, which itself lives in code with a version. */
export const auditRuleSettings = pgTable(
  "audit_rule_settings",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    severity: text("severity").$type<Severity>(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.ruleId] })],
);

export const auditIssues = pgTable(
  "audit_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    url: text("url").notNull(),
    /** Hash of the URL plus an optional evidence key, e.g. the broken link's target. */
    identityHash: text("identity_hash").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    state: text("state").$type<IssueState>().notNull().default("open"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    firstSeenRunId: uuid("first_seen_run_id"),
    lastSeenRunId: uuid("last_seen_run_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedRunId: uuid("resolved_run_id"),
    ignoredUntil: date("ignored_until"),
    details: jsonb("details").$type<{ evidence: Record<string, unknown>; reason?: string }>().notNull(),
  },
  (t) => [uniqueIndex("audit_issues_identity_key").on(t.siteId, t.ruleId, t.identityHash), index("audit_issues_site_state_idx").on(t.siteId, t.state)],
);

/** What each crawl saw for an issue. Appended, never rewritten. */
export const auditIssueObservations = pgTable(
  "audit_issue_observations",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => auditIssues.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.crawlRunId] })],
);

/* ----------------------------------------------------------------------------
 * Performance
 * ------------------------------------------------------------------------- */

/** One Lighthouse lab run through PageSpeed Insights. A lab run is not what visitors experience. */
export const performanceRuns = pgTable(
  "performance_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    device: text("device").$type<PerfDevice>().notNull(),
    provider: text("provider").$type<"psi" | "demo">().notNull().default("psi"),
    trigger: text("trigger").$type<"manual" | "scheduled" | "demo">().notNull().default("manual"),
    status: text("status").$type<"queued" | "running" | "done" | "error">().notNull().default("queued"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    finalUrl: text("final_url"),
    lighthouseVersion: text("lighthouse_version"),
    scores: jsonb("scores").$type<LabScores>(),
    metrics: jsonb("metrics").$type<LabMetrics>(),
    opportunities: jsonb("opportunities").$type<LabOpportunity[]>(),
    error: text("error"),
    /** Provider response without screenshots. Kept for the newest runs only. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (t) => [index("performance_runs_site_idx").on(t.siteId, t.url, t.device, t.queuedAt.desc()), index("performance_runs_status_idx").on(t.status)],
);

/** Real-user p75 values from the Chrome UX Report, per collection period. */
export const cruxHistory = pgTable(
  "crux_history",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** The origin the record is for. */
    key: text("key").notNull(),
    formFactor: text("form_factor").$type<CruxFormFactor>().notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    lcpP75: integer("lcp_p75"),
    inpP75: integer("inp_p75"),
    clsP75: doublePrecision("cls_p75"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.key, t.formFactor, t.periodEnd] })],
);

/* ----------------------------------------------------------------------------
 * Alerts and annotations
 * ------------------------------------------------------------------------- */

/** Per-site switches. Thresholds have defaults in code; a row only records a deviation. */
export const alertRules = pgTable(
  "alert_rules",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type").$type<AlertType>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    email: boolean("email").notNull().default(false),
    thresholds: jsonb("thresholds").$type<Record<string, number>>(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.type] })],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: text("type").$type<AlertType>().notNull(),
    /** Site, rule, affected entity and window: the same event is never raised twice. */
    fingerprint: text("fingerprint").notNull(),
    entity: text("entity").notNull().default(""),
    severity: text("severity").$type<AlertSeverity>().notNull(),
    headline: text("headline").notNull(),
    evidence: jsonb("evidence").$type<AlertEvidence>().notNull(),
    status: text("status").$type<AlertStatus>().notNull().default("open"),
    snoozedUntil: date("snoozed_until"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("alerts_fingerprint_key").on(t.fingerprint), index("alerts_site_status_idx").on(t.siteId, t.status), index("alerts_created_idx").on(t.createdAt.desc())],
);

export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** Site-local calendar date the change happened on. */
    date: date("date").notNull(),
    type: text("type").$type<AnnotationType>().notNull(),
    title: text("title").notNull(),
    note: text("note"),
    linkedUrl: text("linked_url"),
    commitSha: text("commit_sha"),
    createdAt: createdAt(),
  },
  (t) => [index("annotations_site_idx").on(t.siteId, t.date)],
);

CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggregation_dirty" (
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregation_dirty_site_id_local_date_pk" PRIMARY KEY("site_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_name" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"normalized_path" text NOT NULL,
	"session_key" text NOT NULL,
	"visitor_key" text,
	"referrer_domain" text,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text,
	"country_code" text,
	"device_type" text NOT NULL,
	"browser_family" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"engaged_ms" integer,
	"bot_flag" boolean DEFAULT false NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "analytics_events_site_id_id_pk" PRIMARY KEY("site_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"site_id" uuid,
	"entity" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dimension_daily_metrics" (
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"visitor_estimate" integer,
	CONSTRAINT "dimension_daily_metrics_site_id_local_date_dimension_value_pk" PRIMARY KEY("site_id","local_date","dimension","value")
);
--> statement-breakpoint
CREATE TABLE "event_daily_metrics" (
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"event_name" text NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_daily_metrics_site_id_local_date_event_name_pk" PRIMARY KEY("site_id","local_date","event_name")
);
--> statement-breakpoint
CREATE TABLE "goal_daily_metrics" (
	"goal_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"converting_sessions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "goal_daily_metrics_goal_id_local_date_source_medium_pk" PRIMARY KEY("goal_id","local_date","source","medium")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"matching_rules" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"site_id" uuid,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error_code" text,
	"cursor" jsonb
);
--> statement-breakpoint
CREATE TABLE "page_daily_metrics" (
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"normalized_path" text NOT NULL,
	"device_type" text NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"visitor_estimate" integer,
	"entries" integer DEFAULT 0 NOT NULL,
	"exits" integer DEFAULT 0 NOT NULL,
	"goal_completions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_daily_metrics_site_id_local_date_normalized_path_device_type_pk" PRIMARY KEY("site_id","local_date","normalized_path","device_type")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "site_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"public_tracking_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "site_credentials_public_tracking_id_unique" UNIQUE("public_tracking_id")
);
--> statement-breakpoint
CREATE TABLE "site_daily_metrics" (
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"visitor_mode" text NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"engaged_sessions" integer DEFAULT 0 NOT NULL,
	"visitor_estimate" integer,
	"event_count" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"converting_sessions" integer DEFAULT 0 NOT NULL,
	"data_watermark" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_daily_metrics_site_id_local_date_pk" PRIMARY KEY("site_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "site_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_method" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"site_id" uuid PRIMARY KEY NOT NULL,
	"allowed_query_params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_path_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_pages" integer DEFAULT 500 NOT NULL,
	"crawl_schedule" text DEFAULT 'weekly' NOT NULL,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"geolocation_enabled" boolean DEFAULT true NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"canonical_origin" text NOT NULL,
	"timezone" text NOT NULL,
	"favicon_url" text,
	"status" text DEFAULT 'pending_setup' NOT NULL,
	"privacy_mode" text DEFAULT 'default' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"first_event_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_daily_metrics" (
	"site_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"referrer_domain" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"visitor_estimate" integer,
	"converting_sessions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "source_daily_metrics_site_id_local_date_source_medium_referrer_domain_campaign_pk" PRIMARY KEY("site_id","local_date","source","medium","referrer_domain","campaign")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"default_range" text DEFAULT '30d' NOT NULL,
	"last_site_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_salts" (
	"local_date" date PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregation_dirty" ADD CONSTRAINT "aggregation_dirty_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_daily_metrics" ADD CONSTRAINT "dimension_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_daily_metrics" ADD CONSTRAINT "event_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_daily_metrics" ADD CONSTRAINT "goal_daily_metrics_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_daily_metrics" ADD CONSTRAINT "goal_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_daily_metrics" ADD CONSTRAINT "page_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_credentials" ADD CONSTRAINT "site_credentials_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_daily_metrics" ADD CONSTRAINT "site_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_domains" ADD CONSTRAINT "site_domains_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_daily_metrics" ADD CONSTRAINT "source_daily_metrics_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_events_site_time_idx" ON "analytics_events" USING btree ("site_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_at_idx" ON "audit_logs" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "goal_daily_site_idx" ON "goal_daily_metrics" USING btree ("site_id","local_date");--> statement-breakpoint
CREATE INDEX "goals_site_idx" ON "goals" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "site_credentials_site_idx" ON "site_credentials" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_domains_hostname_key" ON "site_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "site_domains_site_idx" ON "site_domains" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "sites_live_idx" ON "sites" USING btree ("created_at") WHERE "sites"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");
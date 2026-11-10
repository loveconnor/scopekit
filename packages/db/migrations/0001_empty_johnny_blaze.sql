CREATE TABLE "gsc_page_daily" (
	"property_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"search_type" text NOT NULL,
	"page_url" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_numerator" double precision DEFAULT 0 NOT NULL,
	"data_state" text DEFAULT 'final' NOT NULL,
	CONSTRAINT "gsc_page_daily_property_id_date_search_type_page_url_country_device_pk" PRIMARY KEY("property_id","date","search_type","page_url","country","device")
);
--> statement-breakpoint
CREATE TABLE "gsc_query_daily" (
	"property_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"search_type" text NOT NULL,
	"query" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_numerator" double precision DEFAULT 0 NOT NULL,
	"data_state" text DEFAULT 'final' NOT NULL,
	CONSTRAINT "gsc_query_daily_property_id_date_search_type_query_country_device_pk" PRIMARY KEY("property_id","date","search_type","query","country","device")
);
--> statement-breakpoint
CREATE TABLE "gsc_query_page_daily" (
	"property_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"search_type" text NOT NULL,
	"query" text NOT NULL,
	"page_url" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_numerator" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "gsc_query_page_daily_property_id_date_search_type_query_page_url_pk" PRIMARY KEY("property_id","date","search_type","query","page_url")
);
--> statement-breakpoint
CREATE TABLE "gsc_segment_daily" (
	"property_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"search_type" text NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_numerator" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "gsc_segment_daily_property_id_date_search_type_dimension_value_pk" PRIMARY KEY("property_id","date","search_type","dimension","value")
);
--> statement-breakpoint
CREATE TABLE "gsc_site_daily" (
	"property_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"search_type" text NOT NULL,
	"aggregation_type" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_numerator" double precision DEFAULT 0 NOT NULL,
	"finalized" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gsc_site_daily_property_id_date_search_type_aggregation_type_pk" PRIMARY KEY("property_id","date","search_type","aggregation_type")
);
--> statement-breakpoint
CREATE TABLE "gsc_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"row_count" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"quota_limited" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text,
	"provider" text NOT NULL,
	"account_label" text NOT NULL,
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"scope" text,
	"expires_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"connection_status" text DEFAULT 'connected' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"category" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"score" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"external_property_id" text NOT NULL,
	"external_property_type" text NOT NULL,
	"permission_level" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"backfill_target" date,
	"oldest_synced_date" date,
	"finalized_through" date,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"next_sync_at" timestamp with time zone,
	"sync_heartbeat_at" timestamp with time zone,
	"failure_streak" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "url_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"url" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"index_verdict" text,
	"coverage_state" text,
	"crawled_as" text,
	"google_canonical" text,
	"user_canonical" text,
	"last_crawl_at" timestamp with time zone,
	"robots_txt_state" text,
	"indexing_state" text,
	"page_fetch_state" text,
	"inspection_link" text,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "gsc_page_daily" ADD CONSTRAINT "gsc_page_daily_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_page_daily" ADD CONSTRAINT "gsc_page_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_daily" ADD CONSTRAINT "gsc_query_daily_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_daily" ADD CONSTRAINT "gsc_query_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_page_daily" ADD CONSTRAINT "gsc_query_page_daily_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_page_daily" ADD CONSTRAINT "gsc_query_page_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_segment_daily" ADD CONSTRAINT "gsc_segment_daily_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_segment_daily" ADD CONSTRAINT "gsc_segment_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_site_daily" ADD CONSTRAINT "gsc_site_daily_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_site_daily" ADD CONSTRAINT "gsc_site_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_sync_runs" ADD CONSTRAINT "gsc_sync_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_sync_runs" ADD CONSTRAINT "gsc_sync_runs_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_opportunities" ADD CONSTRAINT "seo_opportunities_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_integrations" ADD CONSTRAINT "site_integrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_integrations" ADD CONSTRAINT "site_integrations_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_inspections" ADD CONSTRAINT "url_inspections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_inspections" ADD CONSTRAINT "url_inspections_property_id_site_integrations_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."site_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gsc_query_page_page_idx" ON "gsc_query_page_daily" USING btree ("property_id","page_url","date");--> statement-breakpoint
CREATE INDEX "gsc_sync_runs_site_idx" ON "gsc_sync_runs" USING btree ("site_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seo_opportunities_subject_key" ON "seo_opportunities" USING btree ("property_id","rule","subject");--> statement-breakpoint
CREATE INDEX "seo_opportunities_site_idx" ON "seo_opportunities" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "site_integrations_site_property_key" ON "site_integrations" USING btree ("site_id","external_property_id");--> statement-breakpoint
CREATE INDEX "site_integrations_due_idx" ON "site_integrations" USING btree ("next_sync_at");--> statement-breakpoint
CREATE INDEX "url_inspections_site_url_idx" ON "url_inspections" USING btree ("site_id","url","checked_at" DESC NULLS LAST);
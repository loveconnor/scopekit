CREATE TABLE "alert_rules" (
	"site_id" uuid NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"thresholds" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_site_id_type_pk" PRIMARY KEY("site_id","type")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"entity" text DEFAULT '' NOT NULL,
	"severity" text NOT NULL,
	"headline" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"snoozed_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"linked_url" text,
	"commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_issue_observations" (
	"issue_id" uuid NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_issue_observations_issue_id_crawl_run_id_pk" PRIMARY KEY("issue_id","crawl_run_id")
);
--> statement-breakpoint
CREATE TABLE "audit_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"url" text NOT NULL,
	"identity_hash" text NOT NULL,
	"severity" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_run_id" uuid,
	"last_seen_run_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_run_id" uuid,
	"ignored_until" date,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_rule_settings" (
	"site_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_rule_settings_site_id_rule_id_pk" PRIMARY KEY("site_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "crawl_links" (
	"crawl_run_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"target_url" text NOT NULL,
	"link_type" text NOT NULL,
	CONSTRAINT "crawl_links_crawl_run_id_source_url_target_url_link_type_pk" PRIMARY KEY("crawl_run_id","source_url","target_url","link_type")
);
--> statement-breakpoint
CREATE TABLE "crawl_pages" (
	"crawl_run_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"status_code" integer,
	"fetch_error" text,
	"redirect_hops" integer DEFAULT 0 NOT NULL,
	"content_type" text,
	"response_ms" integer,
	"robots_blocked" boolean DEFAULT false NOT NULL,
	"in_sitemap" boolean DEFAULT false NOT NULL,
	"indexable" boolean DEFAULT false NOT NULL,
	"title" text,
	"meta_description" text,
	"canonical" text,
	"robots_meta" text,
	"h1" text,
	"h1_count" integer,
	"word_count" integer,
	"internal_inlink_count" integer DEFAULT 0 NOT NULL,
	"internal_outlink_count" integer DEFAULT 0 NOT NULL,
	"issue_count" integer DEFAULT 0 NOT NULL,
	"html_hash" text,
	"depth" integer,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_pages_crawl_run_id_url_pk" PRIMARY KEY("crawl_run_id","url")
);
--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" text DEFAULT 'full' NOT NULL,
	"target_url" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"max_pages" integer NOT NULL,
	"pages_discovered" integer DEFAULT 0 NOT NULL,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"coverage_complete" boolean DEFAULT false NOT NULL,
	"error_summary" text,
	"config_hash" text,
	"crawler_version" integer DEFAULT 1 NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "crux_history" (
	"site_id" uuid NOT NULL,
	"key" text NOT NULL,
	"form_factor" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"lcp_p75" integer,
	"inp_p75" integer,
	"cls_p75" double precision,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crux_history_site_id_key_form_factor_period_end_pk" PRIMARY KEY("site_id","key","form_factor","period_end")
);
--> statement-breakpoint
CREATE TABLE "performance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"url" text NOT NULL,
	"device" text NOT NULL,
	"provider" text DEFAULT 'psi' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"final_url" text,
	"lighthouse_version" text,
	"scores" jsonb,
	"metrics" jsonb,
	"opportunities" jsonb,
	"error" text,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "sitemap_url" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "crawl_excluded_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "performance_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "crux_status" jsonb;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_issue_observations" ADD CONSTRAINT "audit_issue_observations_issue_id_audit_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."audit_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_issue_observations" ADD CONSTRAINT "audit_issue_observations_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_issues" ADD CONSTRAINT "audit_issues_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_rule_settings" ADD CONSTRAINT "audit_rule_settings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_links" ADD CONSTRAINT "crawl_links_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crux_history" ADD CONSTRAINT "crux_history_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_runs" ADD CONSTRAINT "performance_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_fingerprint_key" ON "alerts" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "alerts_site_status_idx" ON "alerts" USING btree ("site_id","status");--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "annotations_site_idx" ON "annotations" USING btree ("site_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_issues_identity_key" ON "audit_issues" USING btree ("site_id","rule_id","identity_hash");--> statement-breakpoint
CREATE INDEX "audit_issues_site_state_idx" ON "audit_issues" USING btree ("site_id","state");--> statement-breakpoint
CREATE INDEX "crawl_links_target_idx" ON "crawl_links" USING btree ("crawl_run_id","target_url");--> statement-breakpoint
CREATE INDEX "crawl_pages_site_idx" ON "crawl_pages" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "crawl_runs_site_idx" ON "crawl_runs" USING btree ("site_id","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crawl_runs_status_idx" ON "crawl_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "performance_runs_site_idx" ON "performance_runs" USING btree ("site_id","url","device","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "performance_runs_status_idx" ON "performance_runs" USING btree ("status");
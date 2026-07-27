CREATE TYPE "public"."category_assignment_role" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'transfer', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."category_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."classification_rule_match_mode" AS ENUM('all', 'any');--> statement-breakpoint
CREATE TYPE "public"."classification_rule_scope" AS ENUM('future_only', 'historical_and_future');--> statement-breakpoint
CREATE TYPE "public"."classification_source" AS ENUM('manual', 'rule', 'import', 'system');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"template_key" text,
	"parent_id" text,
	"kind" "category_kind" NOT NULL,
	"icon_key" text,
	"colour_key" text,
	"status" "category_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "categories_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "categories_name_not_empty" CHECK (length(btrim("categories"."name")) > 0),
	CONSTRAINT "categories_normalized_name_not_empty" CHECK (length(btrim("categories"."normalized_name")) > 0),
	CONSTRAINT "categories_parent_not_self" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id"),
	CONSTRAINT "categories_archive_state_consistent" CHECK (("categories"."status" = 'active' AND "categories"."archived_at" IS NULL) OR ("categories"."status" = 'archived' AND "categories"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "classification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"previous_primary_category_id" text,
	"previous_primary_source" "classification_source",
	"resulting_primary_category_id" text,
	"secondary_categories_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	CONSTRAINT "classification_events_rule_transaction_unique" UNIQUE("user_id","rule_id","transaction_id")
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions_version" integer DEFAULT 1 NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions_version" integer DEFAULT 1 NOT NULL,
	"actions" jsonb NOT NULL,
	"match_mode" "classification_rule_match_mode" DEFAULT 'all' NOT NULL,
	"apply_scope" "classification_rule_scope" DEFAULT 'future_only' NOT NULL,
	"last_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "classification_rules_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "classification_rules_name_not_empty" CHECK (length(btrim("classification_rules"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"filters" jsonb NOT NULL,
	"sort" jsonb NOT NULL,
	"column_preferences" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_name_not_empty" CHECK (length(btrim("saved_views"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tags_user_normalized_name_unique" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "tags_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "tags_name_not_empty" CHECK (length(btrim("tags"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "transaction_category_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"category_id" text NOT NULL,
	"role" "category_assignment_role" NOT NULL,
	"source" "classification_source" NOT NULL,
	"rule_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_category_assignments_unique" UNIQUE("user_id","transaction_id","category_id","role")
);
--> statement-breakpoint
CREATE TABLE "transaction_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"source" "classification_source" NOT NULL,
	"rule_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_tags_unique" UNIQUE("user_id","transaction_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "imported_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_description" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_counterparty" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "user_note" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "rule_suppression_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_events" ADD CONSTRAINT "classification_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_events" ADD CONSTRAINT "classification_events_owner_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."classification_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_events" ADD CONSTRAINT "classification_events_owner_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_assignments" ADD CONSTRAINT "transaction_category_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_assignments" ADD CONSTRAINT "transaction_category_assignments_owner_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_assignments" ADD CONSTRAINT "transaction_category_assignments_owner_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_assignments" ADD CONSTRAINT "transaction_category_assignments_owner_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."classification_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_owner_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_owner_tag_fk" FOREIGN KEY ("tag_id","user_id") REFERENCES "public"."tags"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_tags" ADD CONSTRAINT "transaction_tags_owner_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."classification_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_user_status_idx" ON "categories" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "categories_user_template_idx" ON "categories" USING btree ("user_id","template_key");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_template_unique" ON "categories" USING btree ("user_id","template_key") WHERE "categories"."template_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_root_name_unique" ON "categories" USING btree ("user_id","normalized_name") WHERE "categories"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_parent_name_unique" ON "categories" USING btree ("user_id","parent_id","normalized_name") WHERE "categories"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "classification_events_user_applied_idx" ON "classification_events" USING btree ("user_id","applied_at");--> statement-breakpoint
CREATE INDEX "classification_events_transaction_idx" ON "classification_events" USING btree ("user_id","transaction_id");--> statement-breakpoint
CREATE INDEX "classification_rules_user_enabled_priority_idx" ON "classification_rules" USING btree ("user_id","enabled","priority","created_at","id");--> statement-breakpoint
CREATE INDEX "saved_views_user_updated_idx" ON "saved_views" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_one_default_per_user" ON "saved_views" USING btree ("user_id") WHERE "saved_views"."is_default" = true;--> statement-breakpoint
CREATE INDEX "tags_user_archived_idx" ON "tags" USING btree ("user_id","archived_at");--> statement-breakpoint
CREATE INDEX "transaction_category_assignments_transaction_idx" ON "transaction_category_assignments" USING btree ("user_id","transaction_id","role");--> statement-breakpoint
CREATE INDEX "transaction_category_assignments_category_idx" ON "transaction_category_assignments" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_category_assignments_one_primary" ON "transaction_category_assignments" USING btree ("user_id","transaction_id") WHERE "transaction_category_assignments"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "transaction_tags_transaction_idx" ON "transaction_tags" USING btree ("user_id","transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_tags_tag_idx" ON "transaction_tags" USING btree ("user_id","tag_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_user_id_unique" UNIQUE("id","user_id");
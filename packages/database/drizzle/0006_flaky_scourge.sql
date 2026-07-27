CREATE TYPE "public"."merchant_alias_match_type" AS ENUM('exact_normalized_description', 'normalized_description_contains', 'normalized_description_starts_with', 'exact_counterparty', 'counterparty_contains');--> statement-breakpoint
CREATE TYPE "public"."merchant_source" AS ENUM('manual', 'alias', 'import', 'system');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('active', 'archived', 'merged');--> statement-breakpoint
CREATE TYPE "public"."transfer_source" AS ENUM('system', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('suggested', 'confirmed', 'rejected', 'unlinked');--> statement-breakpoint
CREATE TABLE "internal_transfer_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"outgoing_transaction_id" text NOT NULL,
	"incoming_transaction_id" text NOT NULL,
	"status" "transfer_status" DEFAULT 'suggested' NOT NULL,
	"match_score" integer,
	"match_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" "transfer_source" DEFAULT 'system' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "internal_transfer_links_pair_unique" UNIQUE("user_id","outgoing_transaction_id","incoming_transaction_id"),
	CONSTRAINT "internal_transfer_links_distinct_transactions" CHECK ("internal_transfer_links"."outgoing_transaction_id" <> "internal_transfer_links"."incoming_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "merchant_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"raw_pattern" text NOT NULL,
	"normalized_pattern" text NOT NULL,
	"match_type" "merchant_alias_match_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "merchant_aliases_user_pattern_unique" UNIQUE("user_id","merchant_id","match_type","normalized_pattern"),
	CONSTRAINT "merchant_aliases_raw_pattern_not_empty" CHECK (length(btrim("merchant_aliases"."raw_pattern")) > 0),
	CONSTRAINT "merchant_aliases_normalized_pattern_not_empty" CHECK (length(btrim("merchant_aliases"."normalized_pattern")) > 0),
	CONSTRAINT "merchant_aliases_priority_range" CHECK ("merchant_aliases"."priority" >= 0 AND "merchant_aliases"."priority" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "merchant_merge_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_merchant_id" text NOT NULL,
	"target_merchant_id" text NOT NULL,
	"transaction_assignments" jsonb NOT NULL,
	"alias_assignments" jsonb NOT NULL,
	"source_status_before" "merchant_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	"partial_unmerge" boolean DEFAULT false NOT NULL,
	CONSTRAINT "merchant_merge_events_different_merchants" CHECK ("merchant_merge_events"."source_merchant_id" <> "merchant_merge_events"."target_merchant_id")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"notes" text,
	"status" "merchant_status" DEFAULT 'active' NOT NULL,
	"merged_into_merchant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "merchants_user_normalized_name_unique" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "merchants_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "merchants_display_name_not_empty" CHECK (length(btrim("merchants"."display_name")) > 0),
	CONSTRAINT "merchants_normalized_name_not_empty" CHECK (length(btrim("merchants"."normalized_name")) > 0),
	CONSTRAINT "merchants_merge_state_consistent" CHECK (("merchants"."status" = 'merged' AND "merchants"."merged_into_merchant_id" IS NOT NULL) OR ("merchants"."status" <> 'merged' AND "merchants"."merged_into_merchant_id" IS NULL)),
	CONSTRAINT "merchants_archive_state_consistent" CHECK (("merchants"."status" = 'active' AND "merchants"."archived_at" IS NULL) OR ("merchants"."status" <> 'active'))
);
--> statement-breakpoint
CREATE TABLE "transaction_split_category_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"split_id" text NOT NULL,
	"category_id" text NOT NULL,
	"role" "category_assignment_role" NOT NULL,
	"source" "classification_source" NOT NULL,
	"rule_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_split_category_assignments_unique" UNIQUE("user_id","split_id","category_id","role")
);
--> statement-breakpoint
CREATE TABLE "transaction_split_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"split_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"source" "classification_source" NOT NULL,
	"rule_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_split_tags_unique" UNIQUE("user_id","split_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"position" integer NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency_code" text NOT NULL,
	"description" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "transaction_splits_transaction_position_unique" UNIQUE("user_id","transaction_id","position"),
	CONSTRAINT "transaction_splits_position_range" CHECK ("transaction_splits"."position" >= 0 AND "transaction_splits"."position" < 50),
	CONSTRAINT "transaction_splits_currency_code_format" CHECK ("transaction_splits"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_source" "merchant_source";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_transfer_links" ADD CONSTRAINT "internal_transfer_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_transfer_links" ADD CONSTRAINT "internal_transfer_links_owner_outgoing_fk" FOREIGN KEY ("outgoing_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_transfer_links" ADD CONSTRAINT "internal_transfer_links_owner_incoming_fk" FOREIGN KEY ("incoming_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_aliases" ADD CONSTRAINT "merchant_aliases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_aliases" ADD CONSTRAINT "merchant_aliases_owner_merchant_fk" FOREIGN KEY ("merchant_id","user_id") REFERENCES "public"."merchants"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_merge_events" ADD CONSTRAINT "merchant_merge_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_merge_events" ADD CONSTRAINT "merchant_merge_events_owner_source_fk" FOREIGN KEY ("source_merchant_id","user_id") REFERENCES "public"."merchants"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_merge_events" ADD CONSTRAINT "merchant_merge_events_owner_target_fk" FOREIGN KEY ("target_merchant_id","user_id") REFERENCES "public"."merchants"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_owner_merged_into_fk" FOREIGN KEY ("merged_into_merchant_id","user_id") REFERENCES "public"."merchants"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_category_assignments" ADD CONSTRAINT "transaction_split_category_assignments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_category_assignments" ADD CONSTRAINT "transaction_split_category_assignments_owner_split_fk" FOREIGN KEY ("split_id","user_id") REFERENCES "public"."transaction_splits"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_category_assignments" ADD CONSTRAINT "transaction_split_category_assignments_owner_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_category_assignments" ADD CONSTRAINT "transaction_split_category_assignments_owner_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."classification_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_tags" ADD CONSTRAINT "transaction_split_tags_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_tags" ADD CONSTRAINT "transaction_split_tags_owner_split_fk" FOREIGN KEY ("split_id","user_id") REFERENCES "public"."transaction_splits"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_tags" ADD CONSTRAINT "transaction_split_tags_owner_tag_fk" FOREIGN KEY ("tag_id","user_id") REFERENCES "public"."tags"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split_tags" ADD CONSTRAINT "transaction_split_tags_owner_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."classification_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_owner_transaction_fk" FOREIGN KEY ("transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_transfer_links_user_status_idx" ON "internal_transfer_links" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "internal_transfer_links_outgoing_idx" ON "internal_transfer_links" USING btree ("user_id","outgoing_transaction_id");--> statement-breakpoint
CREATE INDEX "internal_transfer_links_incoming_idx" ON "internal_transfer_links" USING btree ("user_id","incoming_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_transfer_links_confirmed_outgoing_unique" ON "internal_transfer_links" USING btree ("user_id","outgoing_transaction_id") WHERE "internal_transfer_links"."status" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "internal_transfer_links_confirmed_incoming_unique" ON "internal_transfer_links" USING btree ("user_id","incoming_transaction_id") WHERE "internal_transfer_links"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "merchant_aliases_user_enabled_priority_idx" ON "merchant_aliases" USING btree ("user_id","enabled","priority","created_at","id");--> statement-breakpoint
CREATE INDEX "merchant_aliases_merchant_idx" ON "merchant_aliases" USING btree ("user_id","merchant_id");--> statement-breakpoint
CREATE INDEX "merchant_merge_events_user_created_idx" ON "merchant_merge_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "merchants_user_status_idx" ON "merchants" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "transaction_split_category_assignments_split_idx" ON "transaction_split_category_assignments" USING btree ("user_id","split_id","role");--> statement-breakpoint
CREATE INDEX "transaction_split_category_assignments_category_idx" ON "transaction_split_category_assignments" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_split_category_assignments_one_primary" ON "transaction_split_category_assignments" USING btree ("user_id","split_id") WHERE "transaction_split_category_assignments"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "transaction_split_tags_split_idx" ON "transaction_split_tags" USING btree ("user_id","split_id");--> statement-breakpoint
CREATE INDEX "transaction_split_tags_tag_idx" ON "transaction_split_tags" USING btree ("user_id","tag_id");--> statement-breakpoint
CREATE INDEX "transaction_splits_transaction_idx" ON "transaction_splits" USING btree ("user_id","transaction_id","archived_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_merchant_fk" FOREIGN KEY ("merchant_id","user_id") REFERENCES "public"."merchants"("id","user_id") ON DELETE no action ON UPDATE no action;
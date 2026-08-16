CREATE TYPE "public"."alert_event_type" AS ENUM('budget_approaching', 'budget_exceeded', 'reconciliation_mismatch', 'uncategorized_transactions', 'goal_milestone', 'goal_deadline');--> statement-breakpoint
CREATE TYPE "public"."alert_rule_type" AS ENUM('uncategorized_transactions', 'goal_milestone', 'goal_deadline');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('weekly', 'monthly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."goal_tracking_mode" AS ENUM('manual', 'account_balance');--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"rule_id" text,
	"type" "alert_event_type" NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"dedupe_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "alert_events_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "alert_events_user_dedupe_unique" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "alert_events_dedupe_key_not_empty" CHECK (length(btrim("alert_events"."dedupe_key")) > 0)
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "alert_rule_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "alert_rules_config_object" CHECK ("alert_rules"."config" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"period_type" "budget_period" NOT NULL,
	"category_id" text,
	"account_id" text,
	"custom_start_date" date,
	"custom_end_date" date,
	"warning_threshold" integer,
	"rollover_enabled" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "budgets_name_not_empty" CHECK (length(btrim("budgets"."name")) > 0),
	CONSTRAINT "budgets_currency_code_format" CHECK ("budgets"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budgets_amount_positive" CHECK ("budgets"."amount" > 0),
	CONSTRAINT "budgets_warning_threshold_range" CHECK ("budgets"."warning_threshold" IS NULL OR ("budgets"."warning_threshold" >= 1 AND "budgets"."warning_threshold" <= 100)),
	CONSTRAINT "budgets_custom_period_consistent" CHECK (("budgets"."period_type" = 'custom' AND "budgets"."custom_start_date" IS NOT NULL AND "budgets"."custom_end_date" IS NOT NULL) OR ("budgets"."period_type" <> 'custom' AND "budgets"."custom_start_date" IS NULL AND "budgets"."custom_end_date" IS NULL)),
	CONSTRAINT "budgets_custom_period_range" CHECK ("budgets"."custom_start_date" IS NULL OR "budgets"."custom_end_date" IS NULL OR "budgets"."custom_start_date" <= "budgets"."custom_end_date")
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"target_amount" numeric(20, 6) NOT NULL,
	"target_date" date,
	"tracking_mode" "goal_tracking_mode" NOT NULL,
	"account_id" text,
	"manual_saved_amount" numeric(20, 6),
	"enabled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_goals_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "savings_goals_name_not_empty" CHECK (length(btrim("savings_goals"."name")) > 0),
	CONSTRAINT "savings_goals_currency_code_format" CHECK ("savings_goals"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "savings_goals_target_positive" CHECK ("savings_goals"."target_amount" > 0),
	CONSTRAINT "savings_goals_manual_saved_non_negative" CHECK ("savings_goals"."manual_saved_amount" IS NULL OR "savings_goals"."manual_saved_amount" >= 0),
	CONSTRAINT "savings_goals_tracking_mode_consistent" CHECK (("savings_goals"."tracking_mode" = 'account_balance' AND "savings_goals"."account_id" IS NOT NULL) OR ("savings_goals"."tracking_mode" = 'manual' AND "savings_goals"."account_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_owner_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."alert_rules"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."financial_accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_owner_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."financial_accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_user_state_idx" ON "alert_events" USING btree ("user_id","read_at","dismissed_at");--> statement-breakpoint
CREATE INDEX "alert_rules_user_enabled_idx" ON "alert_rules" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "budgets_user_enabled_idx" ON "budgets" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "savings_goals_user_enabled_idx" ON "savings_goals" USING btree ("user_id","enabled");
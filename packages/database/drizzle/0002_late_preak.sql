CREATE TYPE "public"."duplicate_status" AS ENUM('none', 'exact', 'probable');--> statement-breakpoint
CREATE TYPE "public"."final_transaction_status" AS ENUM('confirmed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."raw_review_status" AS ENUM('valid', 'needs_review', 'invalid', 'excluded', 'duplicate_candidate');--> statement-breakpoint
CREATE TYPE "public"."statement_duplicate_state" AS ENUM('safe_to_continue', 'previously_uploaded', 'previously_imported');--> statement-breakpoint
CREATE TYPE "public"."statement_processing_status" AS ENUM('uploaded', 'parsing', 'needs_mapping', 'needs_review', 'ready', 'imported', 'failed');--> statement-breakpoint
CREATE TYPE "public"."statement_reconciliation_status" AS ENUM('matched', 'mismatch', 'unverifiable', 'not_run');--> statement-breakpoint
CREATE TYPE "public"."statement_source_type" AS ENUM('csv');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('credit', 'debit', 'unknown');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"job_type" text DEFAULT 'statement.parse.csv' NOT NULL,
	"status" "import_job_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"parser_version" text,
	"row_count" integer,
	"candidate_count" integer,
	"warning_count" integer,
	"error_code" text,
	"error_message_safe" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "raw_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"financial_account_id" text NOT NULL,
	"source_row" integer NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"raw_description" text DEFAULT '' NOT NULL,
	"raw_booking_date" text,
	"raw_value_date" text,
	"raw_amount" text,
	"raw_currency" text,
	"raw_balance" text,
	"booking_date" date,
	"value_date" date,
	"amount" numeric(20, 6),
	"currency_code" text,
	"direction" "transaction_direction" DEFAULT 'unknown' NOT NULL,
	"balance_after" numeric(20, 6),
	"counterparty" text,
	"bank_transaction_id" text,
	"confidence" numeric(5, 4),
	"field_confidence" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "raw_review_status" DEFAULT 'needs_review' NOT NULL,
	"duplicate_status" "duplicate_status" DEFAULT 'none' NOT NULL,
	"duplicate_fingerprint" text,
	"duplicate_match_reasons" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_transactions_statement_row_unique" UNIQUE("statement_id","source_row"),
	CONSTRAINT "raw_transactions_source_row_positive" CHECK ("raw_transactions"."source_row" > 0)
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"financial_account_id" text NOT NULL,
	"source_type" "statement_source_type" DEFAULT 'csv' NOT NULL,
	"original_filename" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_checksum" text NOT NULL,
	"storage_key" text,
	"retain_original_file" boolean DEFAULT false NOT NULL,
	"processing_status" "statement_processing_status" DEFAULT 'uploaded' NOT NULL,
	"duplicate_state" "statement_duplicate_state" DEFAULT 'safe_to_continue' NOT NULL,
	"upload_idempotency_key" text NOT NULL,
	"mapping_snapshot" jsonb,
	"detected_language" text,
	"period_start" date,
	"period_end" date,
	"currency_code" text,
	"opening_balance" numeric(20, 6),
	"closing_balance" numeric(20, 6),
	"reconciliation_expected_closing" numeric(20, 6),
	"reconciliation_stated_closing" numeric(20, 6),
	"reconciliation_difference" numeric(20, 6),
	"reconciliation_tolerance" numeric(20, 6) DEFAULT '0.01' NOT NULL,
	"reconciliation_reason" text,
	"reconciliation_status" "statement_reconciliation_status" DEFAULT 'not_run' NOT NULL,
	"confirmation_idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "statements_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "statements_user_upload_key_unique" UNIQUE("user_id","upload_idempotency_key"),
	CONSTRAINT "statements_filename_not_empty" CHECK (length(btrim("statements"."original_filename")) > 0),
	CONSTRAINT "statements_checksum_format" CHECK ("statements"."file_checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "statements_period_range" CHECK ("statements"."period_start" IS NULL OR "statements"."period_end" IS NULL OR "statements"."period_start" <= "statements"."period_end")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"financial_account_id" text NOT NULL,
	"statement_id" text NOT NULL,
	"source_raw_transaction_id" text NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date,
	"amount" numeric(20, 6) NOT NULL,
	"currency_code" text NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"balance_after" numeric(20, 6),
	"raw_description" text NOT NULL,
	"normalized_description" text NOT NULL,
	"counterparty" text,
	"bank_transaction_id" text,
	"source_type" "statement_source_type" DEFAULT 'csv' NOT NULL,
	"status" "final_transaction_status" DEFAULT 'confirmed' NOT NULL,
	"duplicate_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_source_raw_unique" UNIQUE("source_raw_transaction_id"),
	CONSTRAINT "transactions_currency_code_format" CHECK ("transactions"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_owner_statement_fk" FOREIGN KEY ("statement_id","user_id") REFERENCES "public"."statements"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_transactions" ADD CONSTRAINT "raw_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_transactions" ADD CONSTRAINT "raw_transactions_owner_statement_fk" FOREIGN KEY ("statement_id","user_id") REFERENCES "public"."statements"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_transactions" ADD CONSTRAINT "raw_transactions_owner_account_fk" FOREIGN KEY ("financial_account_id","user_id") REFERENCES "public"."financial_accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_owner_account_fk" FOREIGN KEY ("financial_account_id","user_id") REFERENCES "public"."financial_accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_account_fk" FOREIGN KEY ("financial_account_id","user_id") REFERENCES "public"."financial_accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_statement_fk" FOREIGN KEY ("statement_id","user_id") REFERENCES "public"."statements"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_raw_fk" FOREIGN KEY ("source_raw_transaction_id","user_id") REFERENCES "public"."raw_transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_user_status_idx" ON "import_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "import_jobs_statement_idx" ON "import_jobs" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "raw_transactions_statement_review_idx" ON "raw_transactions" USING btree ("statement_id","review_status");--> statement-breakpoint
CREATE INDEX "raw_transactions_fingerprint_idx" ON "raw_transactions" USING btree ("user_id","duplicate_fingerprint");--> statement-breakpoint
CREATE INDEX "statements_user_created_idx" ON "statements" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "statements_account_idx" ON "statements" USING btree ("financial_account_id");--> statement-breakpoint
CREATE INDEX "statements_checksum_idx" ON "statements" USING btree ("user_id","file_checksum");--> statement-breakpoint
CREATE INDEX "statements_status_idx" ON "statements" USING btree ("user_id","processing_status");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("user_id","financial_account_id","booking_date");--> statement-breakpoint
CREATE INDEX "transactions_fingerprint_idx" ON "transactions" USING btree ("user_id","duplicate_fingerprint");
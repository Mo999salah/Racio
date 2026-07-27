CREATE TYPE "public"."financial_account_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."financial_account_type" AS ENUM('checking', 'savings', 'credit', 'cash', 'other');--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"institution_id" text NOT NULL,
	"display_name" text NOT NULL,
	"account_type" "financial_account_type" NOT NULL,
	"currency_code" text NOT NULL,
	"masked_account_identifier" text,
	"masked_iban" text,
	"status" "financial_account_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_user_institution_unique" UNIQUE("user_id","institution_id"),
	CONSTRAINT "financial_accounts_display_name_not_empty" CHECK (length(btrim("financial_accounts"."display_name")) > 0),
	CONSTRAINT "financial_accounts_currency_code_format" CHECK ("financial_accounts"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "financial_accounts_masked_account_identifier_not_full" CHECK ("financial_accounts"."masked_account_identifier" IS NULL OR "financial_accounts"."masked_account_identifier" !~ '^[0-9][0-9 -]{7,}$'),
	CONSTRAINT "financial_accounts_masked_iban_not_full" CHECK ("financial_accounts"."masked_iban" IS NULL OR upper(regexp_replace("financial_accounts"."masked_iban", '[ -]', '', 'g')) !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,}$'),
	CONSTRAINT "financial_accounts_archive_state_consistent" CHECK (("financial_accounts"."status" = 'active' AND "financial_accounts"."archived_at" IS NULL) OR ("financial_accounts"."status" = 'archived' AND "financial_accounts"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"country_code" text NOT NULL,
	"website_url" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_user_normalized_name_unique" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "institutions_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "institutions_name_not_empty" CHECK (length(btrim("institutions"."name")) > 0),
	CONSTRAINT "institutions_normalized_name_not_empty" CHECK (length(btrim("institutions"."normalized_name")) > 0),
	CONSTRAINT "institutions_country_code_format" CHECK ("institutions"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_owner_institution_fk" FOREIGN KEY ("institution_id","user_id") REFERENCES "public"."institutions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_accounts_user_status_idx" ON "financial_accounts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "financial_accounts_institution_id_idx" ON "financial_accounts" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "institutions_user_id_idx" ON "institutions" USING btree ("user_id");
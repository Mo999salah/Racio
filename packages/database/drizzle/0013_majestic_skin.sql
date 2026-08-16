CREATE TYPE "public"."export_status" AS ENUM('preparing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."export_type" AS ENUM('transactions_csv', 'transactions_xlsx', 'account_archive');--> statement-breakpoint
CREATE TABLE "exports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "export_type" NOT NULL,
	"status" "export_status" DEFAULT 'preparing' NOT NULL,
	"request_json" jsonb NOT NULL,
	"storage_key" text,
	"size_bytes" integer,
	"checksum" text,
	"row_count" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "exports_checksum_format" CHECK ("exports"."checksum" IS NULL OR "exports"."checksum" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exports_user_created_idx" ON "exports" USING btree ("user_id","created_at");
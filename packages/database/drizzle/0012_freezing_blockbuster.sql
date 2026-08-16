CREATE TYPE "public"."advisor_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."advisor_proposal_status" AS ENUM('pending', 'executed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "advisor_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" "advisor_message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisor_messages_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "advisor_messages_content_not_empty" CHECK (length(btrim("advisor_messages"."content")) > 0)
);
--> statement-breakpoint
CREATE TABLE "advisor_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "advisor_proposal_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisor_proposals_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "advisor_proposals_type_not_empty" CHECK (length(btrim("advisor_proposals"."type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "advisor_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisor_threads_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "advisor_threads_title_not_empty" CHECK ("advisor_threads"."title" IS NULL OR length(btrim("advisor_threads"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "advisor_messages" ADD CONSTRAINT "advisor_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_messages" ADD CONSTRAINT "advisor_messages_owner_thread_fk" FOREIGN KEY ("thread_id","user_id") REFERENCES "public"."advisor_threads"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_proposals" ADD CONSTRAINT "advisor_proposals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisor_threads" ADD CONSTRAINT "advisor_threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advisor_messages_thread_idx" ON "advisor_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "advisor_proposals_user_status_idx" ON "advisor_proposals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "advisor_threads_user_updated_idx" ON "advisor_threads" USING btree ("user_id","updated_at");
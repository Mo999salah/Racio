ALTER TABLE "classification_events" ADD COLUMN "reviewed_changed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "classification_events" ADD COLUMN "previous_reviewed" boolean;
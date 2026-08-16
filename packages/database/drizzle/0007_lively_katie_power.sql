ALTER TYPE "public"."statement_processing_status" ADD VALUE 'inspecting' BEFORE 'parsing';--> statement-breakpoint
ALTER TYPE "public"."statement_processing_status" ADD VALUE 'needs_sheet_selection' BEFORE 'parsing';--> statement-breakpoint
ALTER TYPE "public"."statement_source_type" ADD VALUE 'xlsx';--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "workbook_inspection" jsonb;--> statement-breakpoint
ALTER TABLE "statements" ADD COLUMN "source_metadata" jsonb;

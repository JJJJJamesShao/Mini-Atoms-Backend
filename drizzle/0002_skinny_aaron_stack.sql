ALTER TABLE "projects" ADD COLUMN "confirmed_spec" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "spec_status" text DEFAULT 'auto' NOT NULL;
ALTER TABLE "document" ADD COLUMN "kind" text DEFAULT 'document' NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "proposal" jsonb;
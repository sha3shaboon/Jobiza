ALTER TYPE "public"."paper_source" ADD VALUE 'reference';--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'Untitled document' NOT NULL,
	"content" jsonb DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb NOT NULL,
	"citation_style" text DEFAULT 'apa' NOT NULL,
	"checks" jsonb,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_user_idx" ON "document" USING btree ("user_id","updated_at");
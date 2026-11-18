CREATE TYPE "public"."decision_by" AS ENUM('ai', 'user');--> statement-breakpoint
CREATE TYPE "public"."full_text_status" AS ENUM('not_requested', 'pending', 'retrieved', 'abstract_only', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_mode" AS ENUM('agentic', 'screening');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'searching', 'screening', 'retrieving', 'extracting', 'synthesizing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."screening_decision" AS ENUM('pending', 'included', 'excluded');--> statement-breakpoint
CREATE TABLE "review" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"mode" "review_mode" NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"status_detail" text,
	"criteria" jsonb DEFAULT '{"include":[],"exclude":[]}'::jsonb NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '["openalex","semantic_scholar","arxiv","pubmed"]'::jsonb NOT NULL,
	"matrix_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"counts" jsonb,
	"synthesis" text,
	"synthesis_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_event" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_record" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"year" integer,
	"venue" text,
	"abstract" text,
	"doi" text,
	"pmid" text,
	"arxiv_id" text,
	"url" text,
	"open_access_pdf_url" text,
	"citation_count" integer,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"screening" "screening_decision" DEFAULT 'pending' NOT NULL,
	"exclusion_reason" text,
	"decided_by" "decision_by",
	"ai" jsonb,
	"full_text" "full_text_status" DEFAULT 'not_requested' NOT NULL,
	"paper_id" text,
	"matrix" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_record" ADD CONSTRAINT "review_record_review_id_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_record" ADD CONSTRAINT "review_record_paper_id_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."paper"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_user_idx" ON "review" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "review_event_review_idx" ON "review_event" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_record_key_idx" ON "review_record" USING btree ("review_id","key");--> statement-breakpoint
CREATE INDEX "review_record_screening_idx" ON "review_record" USING btree ("review_id","screening");
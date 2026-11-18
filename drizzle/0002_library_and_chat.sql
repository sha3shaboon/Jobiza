CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."paper_source" AS ENUM('upload', 'doi', 'url');--> statement-breakpoint
CREATE TYPE "public"."paper_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', text)) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New question' NOT NULL,
	"scope_paper_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"added_by" text,
	"source" "paper_source" NOT NULL,
	"status" "paper_status" DEFAULT 'queued' NOT NULL,
	"status_detail" text,
	"title" text NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"year" integer,
	"venue" text,
	"doi" text,
	"url" text,
	"abstract" text,
	"file_key" text,
	"file_name" text,
	"page_count" integer,
	"metadata_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_page" (
	"paper_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"text" text NOT NULL,
	"method" text DEFAULT 'text' NOT NULL,
	CONSTRAINT "paper_page_paper_id_page_number_pk" PRIMARY KEY("paper_id","page_number")
);
--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_paper_id_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper" ADD CONSTRAINT "paper_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper" ADD CONSTRAINT "paper_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_page" ADD CONSTRAINT "paper_page_paper_id_paper_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."paper"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_paper_idx" ON "chunk" USING btree ("paper_id","chunk_index");--> statement-breakpoint
CREATE INDEX "chunk_workspace_idx" ON "chunk" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "chunk_embedding_idx" ON "chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunk_tsv_idx" ON "chunk" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "conversation_user_idx" ON "conversation" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "message_conversation_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_workspace_idx" ON "paper" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_workspace_doi_idx" ON "paper" USING btree ("workspace_id","doi") WHERE doi is not null;
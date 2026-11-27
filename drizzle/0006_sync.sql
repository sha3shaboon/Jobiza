CREATE TABLE "sync_device" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"share_api_key" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paired_peer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_peer" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"port" integer NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_pending" (
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"row" jsonb NOT NULL,
	"children" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_pending_table_name_row_id_pk" PRIMARY KEY("table_name","row_id")
);
--> statement-breakpoint
CREATE TABLE "sync_tombstone" (
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_seq" bigint,
	CONSTRAINT "sync_tombstone_table_name_row_id_pk" PRIMARY KEY("table_name","row_id")
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "paper" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "review" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "review_event" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "review_record" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "sync_seq" bigint;--> statement-breakpoint
CREATE INDEX "sync_tombstone_seq_idx" ON "sync_tombstone" USING btree ("sync_seq");--> statement-breakpoint
-- Device sync: every write gets the next change number, and deletes leave a
-- tombstone, so a device can ask a peer for "everything since change N".
CREATE SEQUENCE IF NOT EXISTS "jobiza_sync_seq";--> statement-breakpoint
CREATE OR REPLACE FUNCTION jobiza_sync_stamp() RETURNS trigger AS $$
BEGIN
  NEW.sync_seq := nextval('jobiza_sync_seq');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION jobiza_sync_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_tombstone (table_name, row_id, deleted_at, sync_seq)
  VALUES (TG_TABLE_NAME, OLD.id, now(), nextval('jobiza_sync_seq'))
  ON CONFLICT (table_name, row_id) DO UPDATE SET deleted_at = now(), sync_seq = nextval('jobiza_sync_seq');
  RETURN OLD;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION jobiza_sync_tombstone_stamp() RETURNS trigger AS $$
BEGIN
  IF NEW.sync_seq IS NULL THEN NEW.sync_seq := nextval('jobiza_sync_seq'); END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER sync_tombstone_stamp BEFORE INSERT ON sync_tombstone FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone_stamp();--> statement-breakpoint
UPDATE "paper" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "paper_sync_seq_idx" ON "paper" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER paper_sync_stamp BEFORE INSERT OR UPDATE ON "paper" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER paper_sync_tombstone AFTER DELETE ON "paper" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "conversation" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "conversation_sync_seq_idx" ON "conversation" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER conversation_sync_stamp BEFORE INSERT OR UPDATE ON "conversation" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER conversation_sync_tombstone AFTER DELETE ON "conversation" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "message" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "message_sync_seq_idx" ON "message" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER message_sync_stamp BEFORE INSERT OR UPDATE ON "message" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER message_sync_tombstone AFTER DELETE ON "message" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "review" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "review_sync_seq_idx" ON "review" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER review_sync_stamp BEFORE INSERT OR UPDATE ON "review" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER review_sync_tombstone AFTER DELETE ON "review" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "review_record" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "review_record_sync_seq_idx" ON "review_record" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER review_record_sync_stamp BEFORE INSERT OR UPDATE ON "review_record" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER review_record_sync_tombstone AFTER DELETE ON "review_record" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "review_event" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "review_event_sync_seq_idx" ON "review_event" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER review_event_sync_stamp BEFORE INSERT OR UPDATE ON "review_event" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER review_event_sync_tombstone AFTER DELETE ON "review_event" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "document" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "document_sync_seq_idx" ON "document" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER document_sync_stamp BEFORE INSERT OR UPDATE ON "document" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();--> statement-breakpoint
CREATE TRIGGER document_sync_tombstone AFTER DELETE ON "document" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_tombstone();--> statement-breakpoint
UPDATE "user_settings" SET sync_seq = nextval('jobiza_sync_seq');--> statement-breakpoint
CREATE INDEX "user_settings_sync_seq_idx" ON "user_settings" USING btree ("sync_seq");--> statement-breakpoint
CREATE TRIGGER user_settings_sync_stamp BEFORE INSERT OR UPDATE ON "user_settings" FOR EACH ROW EXECUTE FUNCTION jobiza_sync_stamp();

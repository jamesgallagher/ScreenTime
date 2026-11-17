ALTER TABLE "kid_messages" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kid_messages" ADD COLUMN "seen_by" uuid;--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_seen_by_parents_id_fk" FOREIGN KEY ("seen_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "kid_messages" SET "seen_at" = "created_at" WHERE "seen_at" IS NULL;
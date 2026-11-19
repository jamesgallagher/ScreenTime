ALTER TABLE "kids" ADD COLUMN "kind" text DEFAULT 'kid' NOT NULL;--> statement-breakpoint
ALTER TABLE "kids" ADD CONSTRAINT "kids_kind" CHECK ("kids"."kind" in ('kid', 'shared'));
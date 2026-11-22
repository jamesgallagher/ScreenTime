ALTER TABLE "devices" ADD COLUMN "app_version_code" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "update_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "update_requested_code" integer;
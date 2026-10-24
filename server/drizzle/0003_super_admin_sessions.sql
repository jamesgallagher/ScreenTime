ALTER TABLE "parent_sessions" ALTER COLUMN "parent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_sessions" ALTER COLUMN "family_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parent_sessions" ADD CONSTRAINT "parent_sessions_parent_family" CHECK (("parent_sessions"."parent_id" is null) = ("parent_sessions"."family_id" is null));
ALTER TABLE "kid_messages" DROP CONSTRAINT "kid_messages_preset_id_message_presets_id_fk";
--> statement-breakpoint
ALTER TABLE "kid_messages" ADD CONSTRAINT "kid_messages_preset_id_message_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."message_presets"("id") ON DELETE set null ON UPDATE no action;
CREATE TABLE "device_games" (
	"family_id" uuid NOT NULL,
	"kid_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"game" text NOT NULL,
	"label" text NOT NULL,
	"exe_path" text NOT NULL,
	"source" text NOT NULL,
	"shortcut" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "device_games_device_id_game_pk" PRIMARY KEY("device_id","game"),
	CONSTRAINT "device_games_source" CHECK ("device_games"."source" in ('found', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_kid_id_kids_id_fk" FOREIGN KEY ("kid_id") REFERENCES "public"."kids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_games" ADD CONSTRAINT "device_games_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE device_games ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY family_isolation ON device_games
  USING (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid)
  WITH CHECK (family_id = NULLIF(current_setting('app.family_id', true), '')::uuid);

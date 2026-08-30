CREATE TABLE "calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_seed" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_subscriptions_wg_member_idx" ON "calendar_subscriptions" USING btree ("wg_id","member_id");
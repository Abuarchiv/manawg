CREATE TABLE "wg_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 10 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "wg_invites" ADD CONSTRAINT "wg_invites_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_invites" ADD CONSTRAINT "wg_invites_created_by_member_id_wg_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wg_invites_token_idx" ON "wg_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "wg_invites_wg_id_idx" ON "wg_invites" USING btree ("wg_id");--> statement-breakpoint
ALTER TABLE "wg_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "wg_invites" FROM anon, authenticated;
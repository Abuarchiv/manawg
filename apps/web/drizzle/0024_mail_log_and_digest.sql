CREATE TABLE "mail_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"wg_id" uuid,
	"member_id" uuid,
	"status" text DEFAULT 'sending' NOT NULL,
	"provider_id" text,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mail_log_status_check" CHECK ("mail_log"."status" in ('sending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "wg_members" ADD COLUMN "notify_digest_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_log_dedupe_key_idx" ON "mail_log" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "mail_log_kind_created_idx" ON "mail_log" USING btree ("kind","created_at");--> statement-breakpoint
ALTER TABLE "mail_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "mail_log" FROM anon, authenticated;

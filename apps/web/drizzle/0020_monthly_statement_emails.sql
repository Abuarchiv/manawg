CREATE TABLE "statement_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"month_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"provider_id" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "statement_emails_status_check" CHECK ("statement_emails"."status" in ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "wg_members" ADD COLUMN "notify_statement_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_emails" ADD CONSTRAINT "statement_emails_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_emails" ADD CONSTRAINT "statement_emails_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "statement_emails_member_month_idx" ON "statement_emails" USING btree ("member_id","month_key");--> statement-breakpoint
CREATE INDEX "statement_emails_wg_idx" ON "statement_emails" USING btree ("wg_id");--> statement-breakpoint
ALTER TABLE "statement_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "statement_emails" FROM anon, authenticated;

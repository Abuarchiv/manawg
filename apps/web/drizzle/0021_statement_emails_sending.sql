ALTER TABLE "statement_emails" DROP CONSTRAINT "statement_emails_status_check";--> statement-breakpoint
ALTER TABLE "statement_emails" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statement_emails" ADD CONSTRAINT "statement_emails_status_check" CHECK ("statement_emails"."status" in ('pending', 'sending', 'sent', 'failed', 'skipped'));
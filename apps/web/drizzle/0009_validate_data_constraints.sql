-- The data behind these constraints was checked before this migration was
-- prepared. VALIDATE makes the existing invariants part of the release gate;
-- if an older row violates one, this migration must fail before release.
ALTER TABLE "announcements" VALIDATE CONSTRAINT "announcements_kind_check";--> statement-breakpoint
ALTER TABLE "announcements" VALIDATE CONSTRAINT "announcements_status_check";--> statement-breakpoint
ALTER TABLE "announcements" VALIDATE CONSTRAINT "announcements_source_check";--> statement-breakpoint
ALTER TABLE "chores" VALIDATE CONSTRAINT "chores_recurrence_type_check";--> statement-breakpoint
ALTER TABLE "expense_splits" VALIDATE CONSTRAINT "expense_splits_amount_cents_check";--> statement-breakpoint
ALTER TABLE "expenses" VALIDATE CONSTRAINT "expenses_amount_cents_check";--> statement-breakpoint
ALTER TABLE "wg_chat_messages" VALIDATE CONSTRAINT "wg_chat_messages_kind_check";

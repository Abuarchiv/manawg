-- Member foreign keys without an index make deleting or merging a member scan whole tables.
-- These indexes live only here: the schema check requires the snapshot's indexes and allows more.
CREATE INDEX IF NOT EXISTS "announcements_author_member_idx" ON "announcements" ("author_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_resolved_by_member_idx" ON "announcements" ("resolved_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_subscriptions_member_idx" ON "calendar_subscriptions" ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chores_assigned_member_idx" ON "chores" ("assigned_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_imports_imported_by_member_idx" ON "expense_imports" ("imported_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_payments_from_member_idx" ON "expense_payments" ("from_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_payments_to_member_idx" ON "expense_payments" ("to_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_reminders_creditor_member_idx" ON "expense_reminders" ("creditor_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_reminders_debtor_member_idx" ON "expense_reminders" ("debtor_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_reminders_sent_by_member_idx" ON "expense_reminders" ("sent_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_log_member_idx" ON "mail_log" ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_log_wg_idx" ON "mail_log" ("wg_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_expenses_created_by_member_idx" ON "recurring_expenses" ("created_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_expenses_paid_by_member_idx" ON "recurring_expenses" ("paid_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopping_items_bought_by_member_idx" ON "shopping_items" ("bought_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wg_events_created_by_member_idx" ON "wg_events" ("created_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wg_invites_created_by_member_idx" ON "wg_invites" ("created_by_member_id");

-- Adds CHECK constraints for invariants the app has only ever enforced in
-- JS/zod: non-negative/positive money columns, and enum-shaped text columns
-- that are only constrained by TypeScript union types today.
--
-- Every current write path (grepped across every insert/update site) already
-- respects these constraints. But several of these tables predate the
-- validation that now enforces them (expenses/expense_splits money checks,
-- and the enum columns on chores/announcements/wg_chat_messages), and this
-- migration cannot see production data. Rather than risk this migration
-- failing outright against an old row we can't see, every constraint below is
-- added NOT VALID: Postgres still enforces it on every new INSERT/UPDATE from
-- this point on (closing the gap this migration exists for), it just skips
-- scanning existing rows at ALTER time. A follow-up migration can run
-- `VALIDATE CONSTRAINT` (after confirming with a SELECT that no existing row
-- would violate it) to fully close the loop.
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_kind_check" CHECK ("announcements"."kind" in ('info', 'question', 'problem', 'request', 'decision')) NOT VALID;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_status_check" CHECK ("announcements"."status" in ('open', 'resolved')) NOT VALID;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_source_check" CHECK ("announcements"."source" in ('manual', 'system', 'chore_swap', 'expense', 'shopping')) NOT VALID;--> statement-breakpoint
ALTER TABLE "chores" ADD CONSTRAINT "chores_recurrence_type_check" CHECK ("chores"."recurrence_type" in ('days', 'months')) NOT VALID;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_amount_cents_check" CHECK ("expense_splits"."amount_cents" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_cents_check" CHECK ("expenses"."amount_cents" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "wg_chat_messages" ADD CONSTRAINT "wg_chat_messages_kind_check" CHECK ("wg_chat_messages"."kind" in ('text', 'image', 'system')) NOT VALID;

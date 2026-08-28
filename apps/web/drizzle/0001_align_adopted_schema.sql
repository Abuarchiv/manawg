-- Bring a database that was adopted at 0000_baseline in line with schema.ts.
--
-- The pre-migration databases were maintained by hand with `drizzle-kit push`,
-- which left three deviations from schema.ts. On a freshly created database
-- 0000_baseline already produces the target state, so every statement here is
-- written to be a no-op in that case.

-- schema.ts declares .default('push'); the pushed column has no DEFAULT.
ALTER TABLE "expense_reminders" ALTER COLUMN "channel" SET DEFAULT 'push';--> statement-breakpoint

-- Telegram support was removed; the wider check is dead. The table is empty in
-- every environment, so narrowing it cannot reject existing rows.
ALTER TABLE "expense_reminders" DROP CONSTRAINT IF EXISTS "expense_reminders_channel_check";--> statement-breakpoint
ALTER TABLE "expense_reminders" ADD CONSTRAINT "expense_reminders_channel_check" CHECK ("expense_reminders"."channel" in ('push', 'inapp'));--> statement-breakpoint

-- normalized_name is GENERATED ALWAYS AS (lower(btrim(name))) over a NOT NULL
-- column, so it can never be null — the constraint only makes that explicit.
ALTER TABLE "shopping_items" ALTER COLUMN "normalized_name" SET NOT NULL;

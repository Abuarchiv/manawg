-- Stored keys move from German to English: rows, inventory audit metadata and chore swap links.
-- The category checks still accept the German keys, because the migration runs before the deploy
-- and the previous app version writes them until the new one is live; 0040 removes them.
-- All-day event times that an API client sent with a clock time move to UTC midnight of the
-- Berlin date they showed on; 0040 then requires UTC midnight.
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_category_check";--> statement-breakpoint
ALTER TABLE "recurring_expenses" DROP CONSTRAINT "recurring_expenses_category_check";--> statement-breakpoint
UPDATE "expenses" SET "category" = CASE "category" WHEN 'lebensmittel' THEN 'groceries' WHEN 'haushalt' THEN 'household' WHEN 'wohnen' THEN 'housing' WHEN 'freizeit' THEN 'leisure' WHEN 'mobilitaet' THEN 'transport' WHEN 'sonstiges' THEN 'other' ELSE "category" END
	WHERE "category" IN ('lebensmittel', 'haushalt', 'wohnen', 'freizeit', 'mobilitaet', 'sonstiges');--> statement-breakpoint
UPDATE "recurring_expenses" SET "category" = CASE "category" WHEN 'lebensmittel' THEN 'groceries' WHEN 'haushalt' THEN 'household' WHEN 'wohnen' THEN 'housing' WHEN 'freizeit' THEN 'leisure' WHEN 'mobilitaet' THEN 'transport' WHEN 'sonstiges' THEN 'other' ELSE "category" END
	WHERE "category" IN ('lebensmittel', 'haushalt', 'wohnen', 'freizeit', 'mobilitaet', 'sonstiges');--> statement-breakpoint
UPDATE "wg_inventory_items"
	SET "unit" = CASE "unit" WHEN 'Stück' THEN 'piece' WHEN 'L' THEN 'litre' WHEN 'kg' THEN 'kilogram' WHEN 'Rolle' THEN 'roll' WHEN 'Packung' THEN 'pack' ELSE "unit" END,
		"category" = CASE "category" WHEN 'bad' THEN 'bathroom' WHEN 'kueche' THEN 'kitchen' WHEN 'putzmittel' THEN 'cleaning' WHEN 'sonstiges' THEN 'other' ELSE "category" END
	WHERE "unit" IN ('Stück', 'L', 'kg', 'Rolle', 'Packung')
		OR "category" IN ('bad', 'kueche', 'putzmittel', 'sonstiges');--> statement-breakpoint
UPDATE "audit_events"
	SET "metadata_json" = ("metadata_json"::jsonb
		|| CASE WHEN "metadata_json"::jsonb ? 'unit'
			THEN jsonb_build_object('unit', CASE "metadata_json"::jsonb ->> 'unit' WHEN 'Stück' THEN 'piece' WHEN 'L' THEN 'litre' WHEN 'kg' THEN 'kilogram' WHEN 'Rolle' THEN 'roll' WHEN 'Packung' THEN 'pack' ELSE "metadata_json"::jsonb ->> 'unit' END)
			ELSE '{}'::jsonb END
		|| CASE WHEN "metadata_json"::jsonb ? 'category'
			THEN jsonb_build_object('category', CASE "metadata_json"::jsonb ->> 'category' WHEN 'bad' THEN 'bathroom' WHEN 'kueche' THEN 'kitchen' WHEN 'putzmittel' THEN 'cleaning' WHEN 'sonstiges' THEN 'other' ELSE "metadata_json"::jsonb ->> 'category' END)
			ELSE '{}'::jsonb END
	)::text
	WHERE "event_type" LIKE 'inventory.%' AND "metadata_json" IS NOT NULL;--> statement-breakpoint
UPDATE "announcements" SET "source_path" = '/chores' || substr("source_path", length('/putzen') + 1)
	WHERE "source_path" LIKE '/putzen?%';--> statement-breakpoint
UPDATE "wg_events" SET "starts_at" = date_trunc('day', "starts_at" AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'
	WHERE "all_day" AND extract(epoch FROM "starts_at") % 86400 <> 0;--> statement-breakpoint
UPDATE "wg_events" SET "ends_at" = date_trunc('day', "ends_at" AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'
	WHERE "all_day" AND extract(epoch FROM "ends_at") % 86400 <> 0;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "category" SET DEFAULT 'other';--> statement-breakpoint
ALTER TABLE "recurring_expenses" ALTER COLUMN "category" SET DEFAULT 'other';--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ALTER COLUMN "unit" SET DEFAULT 'piece';--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ALTER COLUMN "category" SET DEFAULT 'other';--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_check" CHECK ("expenses"."category" IN ('groceries', 'household', 'housing', 'leisure', 'transport', 'other', 'lebensmittel', 'haushalt', 'wohnen', 'freizeit', 'mobilitaet', 'sonstiges'));--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_check" CHECK ("recurring_expenses"."category" IN ('groceries', 'household', 'housing', 'leisure', 'transport', 'other', 'lebensmittel', 'haushalt', 'wohnen', 'freizeit', 'mobilitaet', 'sonstiges'));
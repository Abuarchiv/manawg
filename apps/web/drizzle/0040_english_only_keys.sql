-- Contract step: rewrites rows the previous app version stored with German keys while 0039 was
-- being released, then accepts only the English keys. Apply once the version from 0039 is live.
-- All-day event times get the same straggler rewrite and must be UTC midnight from now on.
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
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_check" CHECK ("expenses"."category" IN ('groceries', 'household', 'housing', 'leisure', 'transport', 'other'));--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_check" CHECK ("recurring_expenses"."category" IN ('groceries', 'household', 'housing', 'leisure', 'transport', 'other'));--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ADD CONSTRAINT "wg_inventory_items_unit_check" CHECK ("wg_inventory_items"."unit" IN ('piece', 'litre', 'kilogram', 'roll', 'pack'));--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ADD CONSTRAINT "wg_inventory_items_category_check" CHECK ("wg_inventory_items"."category" IN ('bathroom', 'kitchen', 'cleaning', 'other'));--> statement-breakpoint
UPDATE "wg_events" SET "starts_at" = date_trunc('day', "starts_at" AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'
	WHERE "all_day" AND extract(epoch FROM "starts_at") % 86400 <> 0;--> statement-breakpoint
UPDATE "wg_events" SET "ends_at" = date_trunc('day', "ends_at" AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'UTC'
	WHERE "all_day" AND extract(epoch FROM "ends_at") % 86400 <> 0;--> statement-breakpoint
ALTER TABLE "wg_events" ADD CONSTRAINT "wg_events_all_day_midnight_check" CHECK (NOT "wg_events"."all_day" OR (("wg_events"."starts_at" AT TIME ZONE 'UTC')::time = '00:00:00' AND ("wg_events"."ends_at" IS NULL OR ("wg_events"."ends_at" AT TIME ZONE 'UTC')::time = '00:00:00')));

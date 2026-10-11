-- Duplicates created before the index existed: the oldest row keeps its name, younger ones get
-- " (2)", " (3)", ... A renamed row can collide with an existing "X (2)", so repeat until clean.
DO $$
BEGIN
	FOR pass IN 1..5 LOOP
		UPDATE "wg_inventory_items" AS item
		SET "name" = item."name" || ' (' || ranked.rn || ')'
		FROM (
			SELECT "id", row_number() OVER (
				PARTITION BY "wg_id", lower(btrim("name")) ORDER BY "created_at", "id"
			) AS rn
			FROM "wg_inventory_items"
		) AS ranked
		WHERE item."id" = ranked."id" AND ranked.rn > 1;
		EXIT WHEN NOT FOUND;
	END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "wg_inventory_items_unique_name" ON "wg_inventory_items" USING btree ("wg_id",lower(btrim("name")));

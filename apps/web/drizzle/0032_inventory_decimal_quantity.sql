ALTER TABLE "wg_inventory_items" ALTER COLUMN "quantity" SET DATA TYPE numeric(10, 2);--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ALTER COLUMN "threshold" SET DATA TYPE numeric(10, 2);--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ALTER COLUMN "threshold" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "wg_inventory_log" ALTER COLUMN "delta" SET DATA TYPE numeric(10, 2);
ALTER TABLE "wg_members" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
WITH oldest_active AS (
	SELECT DISTINCT ON ("wg_id") "id"
	FROM "wg_members"
	WHERE "deactivated_at" IS NULL
	ORDER BY "wg_id", "created_at", "id"
)
UPDATE "wg_members" AS members
SET "role" = 'admin'
FROM oldest_active
WHERE members."id" = oldest_active."id";--> statement-breakpoint
CREATE UNIQUE INDEX "wg_members_one_admin_per_wg_idx" ON "wg_members" USING btree ("wg_id") WHERE "wg_members"."role" = 'admin';--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_amount_cents_check" CHECK ("recurring_expenses"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "wg_members" ADD CONSTRAINT "wg_members_role_check" CHECK ("wg_members"."role" in ('admin', 'member'));

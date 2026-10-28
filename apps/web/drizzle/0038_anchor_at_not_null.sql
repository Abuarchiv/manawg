-- Rows created before anchor_at was required adopt their current due date as the anchor.
UPDATE "chores" SET "anchor_at" = "next_due_at" WHERE "anchor_at" IS NULL;--> statement-breakpoint
UPDATE "recurring_expenses" SET "anchor_at" = "next_due_at" WHERE "anchor_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chores" ALTER COLUMN "anchor_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ALTER COLUMN "anchor_at" SET NOT NULL;

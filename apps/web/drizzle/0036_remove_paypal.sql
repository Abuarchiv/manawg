-- PayPal is gone: payments are cash entries only ('completed' or 'voided').
-- A completed PayPal payment still counts in balances, so stop instead of deleting it.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "expense_payments" WHERE "provider" <> 'manual' AND "status" = 'completed'
	) THEN
		RAISE EXCEPTION '0036 found completed PayPal payments; settle them by hand before removing PayPal';
	END IF;
END $$;
--> statement-breakpoint
-- Open, failed and expired PayPal orders never moved money and never counted in balances.
DELETE FROM "expense_payments" WHERE "provider" <> 'manual';--> statement-breakpoint
ALTER TABLE "expense_payments" DROP CONSTRAINT "expense_payments_provider_check";--> statement-breakpoint
ALTER TABLE "expense_payments" DROP CONSTRAINT "expense_payments_status_check";--> statement-breakpoint
DROP INDEX "expense_payments_provider_order_idx";--> statement-breakpoint
DROP INDEX "expense_payments_active_pair_idx";--> statement-breakpoint
ALTER TABLE "expense_payments" ALTER COLUMN "status" SET DEFAULT 'completed';--> statement-breakpoint
ALTER TABLE "expense_payments" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "expense_payments" DROP COLUMN "provider_order_id";--> statement-breakpoint
ALTER TABLE "expense_payments" DROP COLUMN "payee_merchant_id";--> statement-breakpoint
ALTER TABLE "expense_payments" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "wg_members" DROP COLUMN "paypal_merchant_id";--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_status_check" CHECK ("expense_payments"."status" in ('completed', 'voided'));

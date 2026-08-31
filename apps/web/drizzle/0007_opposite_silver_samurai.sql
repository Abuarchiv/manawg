CREATE TABLE "expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"from_member_id" uuid NOT NULL,
	"to_member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"provider" text DEFAULT 'paypal' NOT NULL,
	"provider_order_id" text NOT NULL,
	"payee_merchant_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_payments_amount_cents_check" CHECK ("expense_payments"."amount_cents" > 0),
	CONSTRAINT "expense_payments_members_check" CHECK ("expense_payments"."from_member_id" <> "expense_payments"."to_member_id"),
	CONSTRAINT "expense_payments_provider_check" CHECK ("expense_payments"."provider" = 'paypal'),
	CONSTRAINT "expense_payments_status_check" CHECK ("expense_payments"."status" in ('created', 'capturing', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "wg_members" ADD COLUMN "paypal_merchant_id" text;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_from_member_id_wg_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_to_member_id_wg_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_payments_wg_idx" ON "expense_payments" USING btree ("wg_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payments_provider_order_idx" ON "expense_payments" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payments_active_pair_idx" ON "expense_payments" USING btree ("wg_id","from_member_id","to_member_id") WHERE "expense_payments"."status" in ('created', 'capturing');

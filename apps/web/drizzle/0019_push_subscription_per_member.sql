DROP INDEX "push_subscriptions_endpoint_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_member_endpoint_idx" ON "push_subscriptions" USING btree ("member_id","endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_endpoint_lookup_idx" ON "push_subscriptions" USING btree ("endpoint");
CREATE INDEX "announcement_comments_member_idx" ON "announcement_comments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "announcement_reactions_member_idx" ON "announcement_reactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "audit_events_member_idx" ON "audit_events" USING btree ("member_id") WHERE "audit_events"."member_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chore_completions_completed_by_idx" ON "chore_completions" USING btree ("completed_by_member_id");--> statement-breakpoint
CREATE INDEX "shopping_items_added_by_idx" ON "shopping_items" USING btree ("added_by_member_id");--> statement-breakpoint
CREATE INDEX "wg_chat_messages_reply_to_idx" ON "wg_chat_messages" USING btree ("reply_to_message_id") WHERE "wg_chat_messages"."reply_to_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wg_chat_messages_sender_idx" ON "wg_chat_messages" USING btree ("sender_member_id");--> statement-breakpoint
CREATE INDEX "wg_chat_reactions_member_idx" ON "wg_chat_reactions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "wg_chat_reads_last_read_idx" ON "wg_chat_reads" USING btree ("last_read_message_id") WHERE "wg_chat_reads"."last_read_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wg_inventory_log_member_idx" ON "wg_inventory_log" USING btree ("member_id") WHERE "wg_inventory_log"."member_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wg_members_auth_user_idx" ON "wg_members" USING btree ("auth_user_id") WHERE "wg_members"."auth_user_id" IS NOT NULL;
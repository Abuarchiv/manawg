-- Fix wg_chat_messages.sender_member_id FK: the column is NOT NULL but the
-- constraint was declared ON DELETE set null, which Postgres rejects at
-- creation time. The original baseline (0000) shipped this invalid state.
-- Cascade-delete chat messages when their sender is removed (which itself
-- cascades from the WG row), so no orphaned chat rows survive.
ALTER TABLE "wg_chat_messages" DROP CONSTRAINT IF EXISTS "wg_chat_messages_sender_member_id_wg_members_id_fk";--> statement-breakpoint
ALTER TABLE "wg_chat_messages" ADD CONSTRAINT "wg_chat_messages_sender_member_id_wg_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- System chat messages (cross-feature announcements such as "expense created")
-- are written without a sender. Relax the NOT NULL constraint so
-- postChatSystemMessage succeeds; regular user messages still always set it.
ALTER TABLE "wg_chat_messages" ALTER COLUMN "sender_member_id" DROP NOT NULL;
CREATE TABLE "announcement_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"content" text NOT NULL,
	"image_url" text,
	"kind" text DEFAULT 'info' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_path" text,
	"pinned_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"member_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chore_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chore_id" uuid NOT NULL,
	"completed_by_member_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"title" text NOT NULL,
	"interval_days" integer DEFAULT 7 NOT NULL,
	"recurrence_type" varchar(10) DEFAULT 'days' NOT NULL,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_member_id" uuid,
	"last_reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"source" text NOT NULL,
	"imported_by_member_id" uuid,
	"row_count_total" integer DEFAULT 0 NOT NULL,
	"row_count_inserted" integer DEFAULT 0 NOT NULL,
	"row_count_skipped" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"raw_payload_hash" text,
	"member_mapping" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "expense_imports_source_check" CHECK ("expense_imports"."source" in ('splitwise_csv', 'splid_csv', 'ocr_screenshot', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "expense_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"debtor_member_id" uuid NOT NULL,
	"creditor_member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"sent_by_member_id" uuid,
	"channel" text DEFAULT 'push' NOT NULL,
	"message" text,
	"oldest_debt_age_days" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_reminders_amount_cents_check" CHECK ("expense_reminders"."amount_cents" >= 0),
	CONSTRAINT "expense_reminders_channel_check" CHECK ("expense_reminders"."channel" in ('push', 'inapp'))
);
--> statement-breakpoint
CREATE TABLE "expense_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"debtor_member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"paid_by_member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"recurring_expense_id" uuid,
	"recurring_due_at" timestamp with time zone,
	"import_id" uuid,
	"import_duplicate_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_responses" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_responses_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "member_absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_key" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"paid_by_member_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"interval_months" integer DEFAULT 1 NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_created_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"splits_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"added_by_member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(btrim(name))) STORED NOT NULL,
	"quantity" text,
	"bought_at" timestamp with time zone,
	"bought_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_chat_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"mentioned_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"sender_member_id" uuid,
	"kind" text NOT NULL,
	"body" text,
	"image_url" text,
	"system_kind" text,
	"system_payload" jsonb,
	"reply_to_message_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_chat_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_chat_reads" (
	"wg_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"last_read_message_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wg_chat_reads_wg_id_member_id_pk" PRIMARY KEY("wg_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "wg_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"recurrence" text,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'Stück' NOT NULL,
	"threshold" integer DEFAULT 1 NOT NULL,
	"category" text DEFAULT 'sonstiges' NOT NULL,
	"last_decremented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_inventory_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"member_id" uuid,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wg_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wg_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"push_opt_in" boolean DEFAULT false NOT NULL,
	"notify_announcements" boolean DEFAULT true NOT NULL,
	"notify_chores" boolean DEFAULT true NOT NULL,
	"notify_expenses" boolean DEFAULT true NOT NULL,
	"notify_shopping" boolean DEFAULT true NOT NULL,
	"notify_reminders" boolean DEFAULT true NOT NULL,
	"notify_chat" boolean DEFAULT true NOT NULL,
	"notify_events" boolean DEFAULT true NOT NULL,
	"quiet_start_hour" integer,
	"quiet_end_hour" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_code" text NOT NULL,
	"name" text NOT NULL,
	"joining_enabled" boolean DEFAULT true NOT NULL,
	"share_code_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_comments" ADD CONSTRAINT "announcement_comments_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_comments" ADD CONSTRAINT "announcement_comments_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reactions" ADD CONSTRAINT "announcement_reactions_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reactions" ADD CONSTRAINT "announcement_reactions_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_member_id_wg_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_resolved_by_member_id_wg_members_id_fk" FOREIGN KEY ("resolved_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_completions" ADD CONSTRAINT "chore_completions_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_completions" ADD CONSTRAINT "chore_completions_completed_by_member_id_wg_members_id_fk" FOREIGN KEY ("completed_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chores" ADD CONSTRAINT "chores_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chores" ADD CONSTRAINT "chores_assigned_member_id_wg_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_imports" ADD CONSTRAINT "expense_imports_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_imports" ADD CONSTRAINT "expense_imports_imported_by_member_id_wg_members_id_fk" FOREIGN KEY ("imported_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reminders" ADD CONSTRAINT "expense_reminders_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reminders" ADD CONSTRAINT "expense_reminders_debtor_member_id_wg_members_id_fk" FOREIGN KEY ("debtor_member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reminders" ADD CONSTRAINT "expense_reminders_creditor_member_id_wg_members_id_fk" FOREIGN KEY ("creditor_member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_reminders" ADD CONSTRAINT "expense_reminders_sent_by_member_id_wg_members_id_fk" FOREIGN KEY ("sent_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_debtor_member_id_wg_members_id_fk" FOREIGN KEY ("debtor_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_member_id_wg_members_id_fk" FOREIGN KEY ("paid_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_import_id_expense_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."expense_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_absences" ADD CONSTRAINT "member_absences_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_member_id_wg_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_paid_by_member_id_wg_members_id_fk" FOREIGN KEY ("paid_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_added_by_member_id_wg_members_id_fk" FOREIGN KEY ("added_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_bought_by_member_id_wg_members_id_fk" FOREIGN KEY ("bought_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_mentions" ADD CONSTRAINT "wg_chat_mentions_message_id_wg_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."wg_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_mentions" ADD CONSTRAINT "wg_chat_mentions_mentioned_member_id_wg_members_id_fk" FOREIGN KEY ("mentioned_member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_messages" ADD CONSTRAINT "wg_chat_messages_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_messages" ADD CONSTRAINT "wg_chat_messages_sender_member_id_wg_members_id_fk" FOREIGN KEY ("sender_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_messages" ADD CONSTRAINT "wg_chat_messages_reply_to_message_id_wg_chat_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."wg_chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_reactions" ADD CONSTRAINT "wg_chat_reactions_message_id_wg_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."wg_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_reactions" ADD CONSTRAINT "wg_chat_reactions_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_reads" ADD CONSTRAINT "wg_chat_reads_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_reads" ADD CONSTRAINT "wg_chat_reads_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_chat_reads" ADD CONSTRAINT "wg_chat_reads_last_read_message_id_wg_chat_messages_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."wg_chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_events" ADD CONSTRAINT "wg_events_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_events" ADD CONSTRAINT "wg_events_created_by_member_id_wg_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_inventory_items" ADD CONSTRAINT "wg_inventory_items_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_inventory_log" ADD CONSTRAINT "wg_inventory_log_item_id_wg_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."wg_inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_inventory_log" ADD CONSTRAINT "wg_inventory_log_member_id_wg_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."wg_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wg_members" ADD CONSTRAINT "wg_members_wg_id_wgs_id_fk" FOREIGN KEY ("wg_id") REFERENCES "public"."wgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_comments_announcement_idx" ON "announcement_comments" USING btree ("announcement_id","created_at");--> statement-breakpoint
CREATE INDEX "announcement_reactions_announcement_idx" ON "announcement_reactions" USING btree ("announcement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_reactions_unique_member_reaction" ON "announcement_reactions" USING btree ("announcement_id","member_id","reaction");--> statement-breakpoint
CREATE INDEX "announcements_wg_idx" ON "announcements" USING btree ("wg_id","created_at");--> statement-breakpoint
CREATE INDEX "announcements_pinned_idx" ON "announcements" USING btree ("wg_id","pinned_at");--> statement-breakpoint
CREATE INDEX "announcements_status_idx" ON "announcements" USING btree ("wg_id","status");--> statement-breakpoint
CREATE INDEX "audit_events_wg_idx" ON "audit_events" USING btree ("wg_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "chore_completions_chore_idx" ON "chore_completions" USING btree ("chore_id","completed_at");--> statement-breakpoint
CREATE INDEX "chores_wg_idx" ON "chores" USING btree ("wg_id","next_due_at");--> statement-breakpoint
CREATE INDEX "expense_imports_wg_started_idx" ON "expense_imports" USING btree ("wg_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_reminders_wg_idx" ON "expense_reminders" USING btree ("wg_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_reminders_debtor_idx" ON "expense_reminders" USING btree ("wg_id","debtor_member_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_reminders_pair_idx" ON "expense_reminders" USING btree ("wg_id","debtor_member_id","creditor_member_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expense_splits_expense_idx" ON "expense_splits" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "expense_splits_debtor_idx" ON "expense_splits" USING btree ("debtor_member_id");--> statement-breakpoint
CREATE INDEX "expenses_wg_idx" ON "expenses" USING btree ("wg_id");--> statement-breakpoint
CREATE INDEX "expenses_payer_idx" ON "expenses" USING btree ("paid_by_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_due_unique_idx" ON "expenses" USING btree ("recurring_expense_id","recurring_due_at") WHERE "expenses"."recurring_expense_id" IS NOT NULL AND "expenses"."recurring_due_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_import_duplicate_key_unique_idx" ON "expenses" USING btree ("wg_id","import_duplicate_key") WHERE "expenses"."import_duplicate_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expenses_import_idx" ON "expenses" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "idempotency_responses_expires_idx" ON "idempotency_responses" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "member_absences_wg_idx" ON "member_absences" USING btree ("wg_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "member_absences_member_idx" ON "member_absences" USING btree ("member_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "push_subscriptions_member_idx" ON "push_subscriptions" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "recurring_expenses_wg_idx" ON "recurring_expenses" USING btree ("wg_id","next_due_at");--> statement-breakpoint
CREATE INDEX "shopping_items_wg_idx" ON "shopping_items" USING btree ("wg_id");--> statement-breakpoint
CREATE INDEX "shopping_items_open_idx" ON "shopping_items" USING btree ("wg_id","bought_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_items_unique_open_name" ON "shopping_items" USING btree ("wg_id","normalized_name") WHERE "shopping_items"."bought_at" IS NULL;--> statement-breakpoint
CREATE INDEX "wg_chat_mentions_member_idx" ON "wg_chat_mentions" USING btree ("mentioned_member_id","created_at");--> statement-breakpoint
CREATE INDEX "wg_chat_mentions_message_idx" ON "wg_chat_mentions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "wg_chat_messages_wg_created_idx" ON "wg_chat_messages" USING btree ("wg_id","created_at");--> statement-breakpoint
CREATE INDEX "wg_chat_messages_reply_idx" ON "wg_chat_messages" USING btree ("wg_id","reply_to_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wg_chat_reactions_unique_idx" ON "wg_chat_reactions" USING btree ("message_id","member_id","emoji");--> statement-breakpoint
CREATE INDEX "wg_chat_reactions_message_idx" ON "wg_chat_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "wg_chat_reads_member_idx" ON "wg_chat_reads" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "wg_events_wg_idx" ON "wg_events" USING btree ("wg_id");--> statement-breakpoint
CREATE INDEX "wg_events_wg_starts_idx" ON "wg_events" USING btree ("wg_id","starts_at");--> statement-breakpoint
CREATE INDEX "wg_events_starts_idx" ON "wg_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "wg_inventory_items_wg_idx" ON "wg_inventory_items" USING btree ("wg_id");--> statement-breakpoint
CREATE INDEX "wg_inventory_items_recent_decrement_idx" ON "wg_inventory_items" USING btree ("wg_id","last_decremented_at");--> statement-breakpoint
CREATE INDEX "wg_inventory_log_item_idx" ON "wg_inventory_log" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "wg_members_wg_idx" ON "wg_members" USING btree ("wg_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wg_members_unique_name_per_wg" ON "wg_members" USING btree ("wg_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "wgs_share_code_idx" ON "wgs" USING btree ("share_code");
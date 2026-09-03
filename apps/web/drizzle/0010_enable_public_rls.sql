-- Defense in depth for the audited 26-table public application schema.
-- The application uses its trusted server database connection; no policies or
-- grants are added here. Missing prerequisites must stop the migration before
-- any security state is changed.
DO $$
DECLARE
	expected_table text;
	missing_tables text[] := ARRAY[]::text[];
BEGIN
	FOREACH expected_table IN ARRAY ARRAY[
		'announcement_comments',
		'announcement_reactions',
		'announcements',
		'audit_events',
		'calendar_subscriptions',
		'chore_completions',
		'chores',
		'expense_imports',
		'expense_payments',
		'expense_reminders',
		'expense_splits',
		'expenses',
		'idempotency_responses',
		'member_absences',
		'push_subscriptions',
		'recurring_expenses',
		'shopping_items',
		'wg_chat_mentions',
		'wg_chat_messages',
		'wg_chat_reactions',
		'wg_chat_reads',
		'wg_events',
		'wg_inventory_items',
		'wg_inventory_log',
		'wg_members',
		'wgs'
	] LOOP
		IF NOT EXISTS (
			SELECT 1
			FROM pg_class AS c
			JOIN pg_namespace AS n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public'
				AND c.relname = expected_table
				AND c.relkind IN ('r', 'p')
		) THEN
			missing_tables := array_append(missing_tables, expected_table);
		END IF;
	END LOOP;

	IF cardinality(missing_tables) > 0 THEN
		RAISE EXCEPTION '0010 requires public app tables; missing: %', array_to_string(missing_tables, ', ');
	END IF;

END $$;
--> statement-breakpoint
ALTER TABLE public.announcement_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.announcement_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chore_completions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.chores ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.expense_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.expense_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.idempotency_responses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.member_absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_chat_mentions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_chat_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_chat_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_chat_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_inventory_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_inventory_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wg_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wgs ENABLE ROW LEVEL SECURITY;

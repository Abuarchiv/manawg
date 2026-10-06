/**
 * The expected security shape of the `public` schema: which Supabase API roles must exist and
 * which member/WG tenant-invariant functions and triggers the migrations install.
 */

export const PUBLIC_SCHEMA = 'public';
export const PUBLIC_ROLES = ['anon', 'authenticated'];
export const MEMBER_WG_INVARIANT_FUNCTIONS = [
	'manawg_assert_member_belongs_to_wg',
	'manawg_assert_expense_split_member_wg',
	'manawg_assert_chore_completion_member_wg',
	'manawg_assert_announcement_member_wg',
	'manawg_assert_inventory_log_member_wg',
	'manawg_assert_chat_member_wg',
	'manawg_assert_chat_mention_wg',
];
// Keep the catalog contract explicit so a removed migration trigger fails closed.
export const MEMBER_WG_INVARIANT_TRIGGERS = [
	[
		'expenses',
		'expenses_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['paid_by_member_id'],
	],
	[
		'expense_imports',
		'expense_imports_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['imported_by_member_id'],
	],
	[
		'expense_payments',
		'expense_payments_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['from_member_id', 'to_member_id'],
	],
	[
		'shopping_items',
		'shopping_items_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['added_by_member_id', 'bought_by_member_id'],
	],
	[
		'announcements',
		'announcements_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['author_member_id', 'resolved_by_member_id'],
	],
	[
		'chores',
		'chores_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['assigned_member_id'],
	],
	[
		'member_absences',
		'member_absences_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['member_id'],
	],
	[
		'recurring_expenses',
		'recurring_expenses_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['created_by_member_id', 'paid_by_member_id'],
	],
	[
		'wg_events',
		'wg_events_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['created_by_member_id'],
	],
	[
		'calendar_subscriptions',
		'calendar_subscriptions_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['member_id'],
	],
	[
		'expense_reminders',
		'expense_reminders_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['debtor_member_id', 'creditor_member_id', 'sent_by_member_id'],
	],
	[
		'audit_events',
		'audit_events_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['member_id'],
	],
	[
		'wg_chat_messages',
		'wg_chat_messages_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['sender_member_id'],
	],
	[
		'wg_chat_reads',
		'wg_chat_reads_member_wg_same_tenant',
		'manawg_assert_member_belongs_to_wg',
		['member_id'],
	],
	[
		'expense_splits',
		'expense_splits_member_wg_same_tenant',
		'manawg_assert_expense_split_member_wg',
	],
	[
		'chore_completions',
		'chore_completions_member_wg_same_tenant',
		'manawg_assert_chore_completion_member_wg',
	],
	[
		'announcement_reactions',
		'announcement_reactions_member_wg_same_tenant',
		'manawg_assert_announcement_member_wg',
	],
	[
		'announcement_comments',
		'announcement_comments_member_wg_same_tenant',
		'manawg_assert_announcement_member_wg',
	],
	[
		'wg_inventory_log',
		'wg_inventory_log_member_wg_same_tenant',
		'manawg_assert_inventory_log_member_wg',
	],
	['wg_chat_reactions', 'wg_chat_reactions_member_wg_same_tenant', 'manawg_assert_chat_member_wg'],
	['wg_chat_mentions', 'wg_chat_mentions_member_wg_same_tenant', 'manawg_assert_chat_mention_wg'],
].map(([table_name, trigger_name, function_name, args = []]) => ({
	table_name,
	trigger_name,
	function_name,
	args,
}));
export const ALLOWED_SECURITY_DEFINER_FUNCTIONS = new Set(MEMBER_WG_INVARIANT_FUNCTIONS);

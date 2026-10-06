import { sql } from 'drizzle-orm';
import {
	type AnyPgColumn,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { wgMembers, wgs } from './wg';

export const expenseImports = pgTable(
	'expense_imports',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		source: text('source').notNull(),
		importedByMemberId: uuid('imported_by_member_id').references(() => wgMembers.id, {
			onDelete: 'set null',
		}),
		rowCountTotal: integer('row_count_total').notNull().default(0),
		rowCountInserted: integer('row_count_inserted').notNull().default(0),
		rowCountSkipped: integer('row_count_skipped').notNull().default(0),
		errorCount: integer('error_count').notNull().default(0),
		rawPayloadHash: text('raw_payload_hash'),
		memberMapping: jsonb('member_mapping'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
	},
	(t) => ({
		wgStartedIdx: index('expense_imports_wg_started_idx').on(t.wgId, t.startedAt.desc()),
		sourceCheck: check(
			'expense_imports_source_check',
			sql`${t.source} in ('splitwise_csv', 'splid_csv', 'ocr_screenshot', 'manual')`,
		),
	}),
);

export const expenses = pgTable(
	'expenses',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		paidByMemberId: uuid('paid_by_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'restrict' }),
		amountCents: integer('amount_cents').notNull(),
		currency: text('currency').notNull().default('EUR'),
		description: text('description').notNull(),
		imageUrl: text('image_url'),
		recurringExpenseId: uuid('recurring_expense_id').references(
			(): AnyPgColumn => recurringExpenses.id,
			{ onDelete: 'set null' },
		),
		recurringDueAt: timestamp('recurring_due_at', { withTimezone: true }),
		importId: uuid('import_id').references(() => expenseImports.id, { onDelete: 'set null' }),
		importDuplicateKey: text('import_duplicate_key'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('expenses_wg_idx').on(t.wgId),
		payerIdx: index('expenses_payer_idx').on(t.paidByMemberId),
		recurringUniqueIdx: uniqueIndex('expenses_recurring_due_unique_idx')
			.on(t.recurringExpenseId, t.recurringDueAt)
			.where(sql`${t.recurringExpenseId} IS NOT NULL AND ${t.recurringDueAt} IS NOT NULL`),
		importDuplicateUniqueIdx: uniqueIndex('expenses_import_duplicate_key_unique_idx')
			.on(t.wgId, t.importDuplicateKey)
			.where(sql`${t.importDuplicateKey} IS NOT NULL`),
		importIdx: index('expenses_import_idx').on(t.importId),
		// Every write path (POST/PATCH validators, import parsers, the recurring
		// cron) already rejects amountCents <= 0 in JS. Added NOT VALID in the
		// migration — this table predates that validation, so an old row from
		// before it existed could still be 0 or negative — new writes are
		// checked immediately either way.
		amountCheck: check('expenses_amount_cents_check', sql`${t.amountCents} > 0`),
	}),
);

export const expenseSplits = pgTable(
	'expense_splits',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		expenseId: uuid('expense_id')
			.notNull()
			.references(() => expenses.id, { onDelete: 'cascade' }),
		debtorMemberId: uuid('debtor_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'restrict' }),
		amountCents: integer('amount_cents').notNull(),
		settledAt: timestamp('settled_at', { withTimezone: true }),
	},
	(t) => ({
		expenseIdx: index('expense_splits_expense_idx').on(t.expenseId),
		debtorIdx: index('expense_splits_debtor_idx').on(t.debtorMemberId),
		// >= 0 (not > 0): a Hamilton-distributed split can legitimately land a
		// debtor's share at 0 cents (e.g. 1c over 3 debtors -> [1, 0, 0]). Added
		// NOT VALID — see the amount_cents_check comment on `expenses` above for
		// why pre-existing rows aren't force-validated here.
		amountCheck: check('expense_splits_amount_cents_check', sql`${t.amountCents} >= 0`),
	}),
);

export const expensePayments = pgTable(
	'expense_payments',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		fromMemberId: uuid('from_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'restrict' }),
		toMemberId: uuid('to_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'restrict' }),
		amountCents: integer('amount_cents').notNull(),
		currency: text('currency').notNull().default('EUR'),
		provider: text('provider').notNull().default('paypal'),
		providerOrderId: text('provider_order_id').notNull(),
		payeeMerchantId: text('payee_merchant_id').notNull(),
		status: text('status').notNull().default('created'),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('expense_payments_wg_idx').on(t.wgId, t.createdAt),
		orderIdx: uniqueIndex('expense_payments_provider_order_idx').on(t.providerOrderId),
		activePairIdx: uniqueIndex('expense_payments_active_pair_idx')
			.on(t.wgId, t.fromMemberId, t.toMemberId)
			.where(sql`${t.status} in ('created', 'capturing')`),
		amountCheck: check('expense_payments_amount_cents_check', sql`${t.amountCents} > 0`),
		membersCheck: check(
			'expense_payments_members_check',
			sql`${t.fromMemberId} <> ${t.toMemberId}`,
		),
		providerCheck: check('expense_payments_provider_check', sql`${t.provider} = 'paypal'`),
		statusCheck: check(
			'expense_payments_status_check',
			sql`${t.status} in ('created', 'capturing', 'completed', 'failed')`,
		),
	}),
);

export const recurringExpenses = pgTable(
	'recurring_expenses',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		createdByMemberId: uuid('created_by_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'restrict' }),
		paidByMemberId: uuid('paid_by_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'restrict' }),
		description: text('description').notNull(),
		amountCents: integer('amount_cents').notNull(),
		intervalMonths: integer('interval_months').notNull().default(1),
		nextDueAt: timestamp('next_due_at', { withTimezone: true }).notNull(),
		// Original due date the monthly cadence anchors to. Monthly advances
		// keep this day-of-month (31. → 28.02 → 31.03) instead of chaining from
		// the clamped result (31.01 → 28.02 → 28.03 …). Null on legacy rows;
		// adopted from nextDueAt on the first advance after deploy.
		anchorAt: timestamp('anchor_at', { withTimezone: true }),
		lastCreatedAt: timestamp('last_created_at', { withTimezone: true }),
		pausedAt: timestamp('paused_at', { withTimezone: true }),
		splitsJson: text('splits_json').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('recurring_expenses_wg_idx').on(t.wgId, t.nextDueAt),
		amountCheck: check('recurring_expenses_amount_cents_check', sql`${t.amountCents} > 0`),
	}),
);

export const expenseReminders = pgTable(
	'expense_reminders',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		debtorMemberId: uuid('debtor_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'cascade' }),
		creditorMemberId: uuid('creditor_member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'cascade' }),
		amountCents: integer('amount_cents').notNull(),
		currency: text('currency').notNull().default('EUR'),
		sentByMemberId: uuid('sent_by_member_id').references(() => wgMembers.id, {
			onDelete: 'set null',
		}),
		channel: text('channel').notNull().default('push'),
		message: text('message'),
		oldestDebtAgeDays: integer('oldest_debt_age_days').notNull().default(0),
		sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('expense_reminders_wg_idx').on(t.wgId, t.sentAt.desc()),
		debtorIdx: index('expense_reminders_debtor_idx').on(t.wgId, t.debtorMemberId, t.sentAt.desc()),
		pairIdx: index('expense_reminders_pair_idx').on(
			t.wgId,
			t.debtorMemberId,
			t.creditorMemberId,
			t.sentAt.desc(),
		),
		amountCheck: check('expense_reminders_amount_cents_check', sql`${t.amountCents} >= 0`),
		// 'telegram' was dropped with the Telegram integration; the table is empty,
		// so the narrower check costs nothing.
		channelCheck: check('expense_reminders_channel_check', sql`${t.channel} in ('push', 'inapp')`),
	}),
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
export type NewExpenseSplit = typeof expenseSplits.$inferInsert;
export type ExpensePayment = typeof expensePayments.$inferSelect;
export type NewExpensePayment = typeof expensePayments.$inferInsert;
export type ExpenseImport = typeof expenseImports.$inferSelect;
export type NewExpenseImport = typeof expenseImports.$inferInsert;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type ExpenseReminder = typeof expenseReminders.$inferSelect;
export type NewExpenseReminder = typeof expenseReminders.$inferInsert;

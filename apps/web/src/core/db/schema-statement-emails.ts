import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';
import { wgMembers, wgs } from './schema';

/**
 * Ledger of monthly statement mails: one row per member and month makes the
 * cron idempotent and resumable. `pending`/`failed` rows are claimed with
 * `FOR UPDATE SKIP LOCKED` and committed as `sending` (with `claimed_at`)
 * before any mail leaves; the send result is written in a second short
 * transaction as `sent`, `failed` (retried on later days) or `skipped` (with
 * `skip_reason`). A `sending` row that never got its result is unconfirmed.
 */
export const statementEmails = pgTable(
	'statement_emails',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		memberId: uuid('member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'cascade' }),
		monthKey: text('month_key').notNull(),
		status: text('status').notNull().default('pending'),
		skipReason: text('skip_reason'),
		providerId: text('provider_id'),
		error: text('error'),
		attempts: integer('attempts').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		sentAt: timestamp('sent_at', { withTimezone: true }),
		claimedAt: timestamp('claimed_at', { withTimezone: true }),
	},
	(t) => ({
		memberMonthUnique: uniqueIndex('statement_emails_member_month_idx').on(t.memberId, t.monthKey),
		wgIdx: index('statement_emails_wg_idx').on(t.wgId),
		statusCheck: check(
			'statement_emails_status_check',
			sql`${t.status} in ('pending', 'sending', 'sent', 'failed', 'skipped')`,
		),
	}),
);

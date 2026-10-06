import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { wgMembers, wgs } from './wg';

export const wgEvents = pgTable(
	'wg_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		allDay: boolean('all_day').notNull().default(false),
		location: text('location'),
		recurrence: text('recurrence'),
		createdByMemberId: uuid('created_by_member_id').references(() => wgMembers.id, {
			onDelete: 'set null',
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('wg_events_wg_idx').on(t.wgId),
		wgStartsIdx: index('wg_events_wg_starts_idx').on(t.wgId, t.startsAt),
		startsIdx: index('wg_events_starts_idx').on(t.startsAt),
	}),
);

export const calendarSubscriptions = pgTable(
	'calendar_subscriptions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		memberId: uuid('member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'cascade' }),
		// The bearer token is derived from this random seed and the server secret;
		// the usable token never sits in the database.
		tokenSeed: text('token_seed').notNull(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgMemberIdx: uniqueIndex('calendar_subscriptions_wg_member_idx').on(t.wgId, t.memberId),
	}),
);

export type WgEvent = typeof wgEvents.$inferSelect;
export type NewWgEvent = typeof wgEvents.$inferInsert;
export type CalendarSubscription = typeof calendarSubscriptions.$inferSelect;
export type NewCalendarSubscription = typeof calendarSubscriptions.$inferInsert;

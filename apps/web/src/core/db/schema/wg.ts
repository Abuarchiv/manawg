import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

export const wgs = pgTable(
	'wgs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		shareCode: text('share_code').notNull(),
		name: text('name').notNull(),
		joiningEnabled: boolean('joining_enabled').notNull().default(true),
		shareCodeRotatedAt: timestamp('share_code_rotated_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		shareCodeIdx: uniqueIndex('wgs_share_code_idx').on(t.shareCode),
	}),
);

// FK policy toward wgMembers (intentional placeholder — no member-removal feature exists yet,
// only whole-WG deletion, so this is currently dead protection):
// - onDelete: 'restrict' — financial/audit tables (expenses, expenseSplits, shoppingItems,
//   announcements, choreCompletions, recurringExpenses) where losing the historical member
//   reference would corrupt records once member-removal ships.
// - onDelete: 'cascade' — tables (absences, debts, chat) whose rows are meaningless without
//   the member and can safely disappear with them.
// When implementing member removal, keep 'restrict' tables intact (reassign/soft-delete the
// member instead of hard-deleting) rather than relaxing these to 'cascade'.
export const wgMembers = pgTable(
	'wg_members',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		authUserId: uuid('auth_user_id'),
		name: text('name').notNull(),
		role: text('role').notNull().default('member'),
		color: text('color'),
		paypalMerchantId: text('paypal_merchant_id'),
		pushOptIn: boolean('push_opt_in').notNull().default(false),
		notifyAnnouncements: boolean('notify_announcements').notNull().default(true),
		notifyChores: boolean('notify_chores').notNull().default(true),
		notifyExpenses: boolean('notify_expenses').notNull().default(true),
		notifyShopping: boolean('notify_shopping').notNull().default(true),
		notifyInventory: boolean('notify_inventory').notNull().default(true),
		notifyReminders: boolean('notify_reminders').notNull().default(true),
		notifyChat: boolean('notify_chat').notNull().default(true),
		notifyEvents: boolean('notify_events').notNull().default(true),
		quietStartHour: integer('quiet_start_hour'),
		quietEndHour: integer('quiet_end_hour'),
		// Soft-delete for "Auszug" (move-out). A member who ever paid an expense,
		// owes a split, added a shopping item, wrote an announcement, completed a
		// chore, or created a recurring expense cannot be hard-deleted — six
		// RESTRICT foreign keys reference wg_members. Instead we set this
		// timestamp: the member drops out of every *active* roster (chore
		// rotation, split candidates, identity picker, dropdowns) while all
		// history and balances stay intact. NULL = active. Reversible.
		deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('wg_members_wg_idx').on(t.wgId),
		uniqueNamePerWg: uniqueIndex('wg_members_unique_name_per_wg').on(t.wgId, t.name),
		uniqueWgAuthUser: uniqueIndex('wg_members_wg_auth_user_unique_idx')
			.on(t.wgId, t.authUserId)
			.where(sql`${t.authUserId} IS NOT NULL`),
		// "Which WGs is this account in?" (`/api/wg/mine`, account deletion)
		// filters on the auth user alone, without a WG.
		authUserIdx: index('wg_members_auth_user_idx')
			.on(t.authUserId)
			.where(sql`${t.authUserId} IS NOT NULL`),
		oneAdminPerWg: uniqueIndex('wg_members_one_admin_per_wg_idx')
			.on(t.wgId)
			.where(sql`${t.role} = 'admin'`),
		roleCheck: check('wg_members_role_check', sql`${t.role} in ('admin', 'member')`),
	}),
);

export const pushSubscriptions = pgTable(
	'push_subscriptions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		memberId: uuid('member_id')
			.notNull()
			.references(() => wgMembers.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull(),
		p256dh: text('p256dh').notNull(),
		authKey: text('auth_key').notNull(),
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		memberIdx: index('push_subscriptions_member_idx').on(t.memberId),
		// One browser endpoint may serve the same account in several WGs, so the
		// subscription is unique per member, not per endpoint. Foreign accounts are
		// kept off a shared endpoint by the subscribe route.
		memberEndpointUnique: uniqueIndex('push_subscriptions_member_endpoint_idx').on(
			t.memberId,
			t.endpoint,
		),
		endpointIdx: index('push_subscriptions_endpoint_lookup_idx').on(t.endpoint),
	}),
);

export const auditEvents = pgTable(
	'audit_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		memberId: uuid('member_id').references(() => wgMembers.id, { onDelete: 'set null' }),
		eventType: text('event_type').notNull(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id'),
		summary: text('summary').notNull(),
		metadataJson: text('metadata_json'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		wgIdx: index('audit_events_wg_idx').on(t.wgId, t.createdAt),
		entityIdx: index('audit_events_entity_idx').on(t.entityType, t.entityId),
		// Foreign-key lookups when a member row is deleted (WG deletion).
		memberIdx: index('audit_events_member_idx')
			.on(t.memberId)
			.where(sql`${t.memberId} IS NOT NULL`),
	}),
);

export type Wg = typeof wgs.$inferSelect;
export type NewWg = typeof wgs.$inferInsert;
export type WgMember = typeof wgMembers.$inferSelect;
export type NewWgMember = typeof wgMembers.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;

import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { wgMembers, wgs } from './schema';

/**
 * Invitation links of a WG. The share code is only the WG's address; joining needs one of these
 * tokens (16 random bytes, base64url). A token stops working at `expires_at`, once `use_count`
 * reaches `max_uses`, or after `revoked_at` is set.
 */
export const wgInvites = pgTable(
	'wg_invites',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		wgId: uuid('wg_id')
			.notNull()
			.references(() => wgs.id, { onDelete: 'cascade' }),
		token: text('token').notNull(),
		createdByMemberId: uuid('created_by_member_id').references(() => wgMembers.id, {
			onDelete: 'set null',
		}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		maxUses: integer('max_uses').notNull().default(10),
		useCount: integer('use_count').notNull().default(0),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
	},
	(t) => ({
		tokenUnique: uniqueIndex('wg_invites_token_idx').on(t.token),
		wgIdx: index('wg_invites_wg_id_idx').on(t.wgId),
	}),
);

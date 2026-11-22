import { bigint, pgTable, uuid } from 'drizzle-orm/pg-core';

/**
 * What changed in a WG, for the one cheap poll an open tab sends (GET /api/wg/[code]/changes).
 * Triggers in migration 0046 set a version to the writing transaction's id whenever a row the
 * list pages show (`data_version`), a member row (`members_version`), or a chat message or
 * read marker (`chat_version`) is written; the client
 * refetches only the reads whose version moved. No foreign key: a WG deletion cascades into the
 * triggered tables, and their triggers must not fail on the vanishing WG row.
 */
export const wgChangeVersions = pgTable('wg_change_versions', {
	wgId: uuid('wg_id').primaryKey(),
	dataVersion: bigint('data_version', { mode: 'number' }).notNull().default(0),
	membersVersion: bigint('members_version', { mode: 'number' }).notNull().default(0),
	chatVersion: bigint('chat_version', { mode: 'number' }).notNull().default(0),
});

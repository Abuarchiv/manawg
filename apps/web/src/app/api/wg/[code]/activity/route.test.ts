import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockDb } from '../../../../../../tests/support/db-mock';
import { type SqlNode, mockDrizzle } from '../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

const TABLE_NAMES = [
	'announcements',
	'auditEvents',
	'choreCompletions',
	'chores',
	'expenses',
	'memberAbsences',
	'recurringExpenses',
	'shoppingItems',
	'wgMembers',
] as const;
const COLUMNS = ['wgId', 'nextDueAt', 'createdAt', 'boughtAt', 'status', 'kind'];
type TableName = (typeof TABLE_NAMES)[number];
const tables = Object.fromEntries(
	TABLE_NAMES.map((name) => [
		name,
		Object.fromEntries([['name', name], ...COLUMNS.map((column) => [column, `${name}.${column}`])]),
	]),
) as Record<TableName, Record<string, string>>;

interface Query {
	table: string;
	where?: SqlNode;
	orderBy?: SqlNode;
	limit?: number;
}

const state = {
	queries: [] as Query[],
	rows: (_query: Query): unknown[] => [],
};

mockDrizzle();
mockObservability();
mockWgMember({ wg: { id: 'wg-1' }, member: { memberId: 'member-1', name: 'Mina' } });
mockDb({
	...tables,
	db: {
		select: () => ({
			from: (table: { name: string }) => {
				const entry: Query = { table: table.name };
				state.queries.push(entry);
				// Only the member list is awaited without `.limit()`.
				const query = Object.assign(Promise.resolve([]), {
					innerJoin: () => query,
					where: (predicate: SqlNode) => {
						entry.where = predicate;
						return query;
					},
					orderBy: (order: SqlNode) => {
						entry.orderBy = order;
						return query;
					},
					limit: async (limit: number) => {
						entry.limit = limit;
						return state.rows(entry);
					},
				});
				return query;
			},
		}),
	},
});

const { GET } = await import('./route');

const get = () => GET(request('/api/wg/MTE8PZAT/activity'), routeCtx());
const hasOp = (node: unknown, op: string): boolean =>
	JSON.stringify(node ?? null).includes(`"op":"${op}"`);

test('due chores are the overdue ones, oldest first, so the 120-row cap keeps them', async () => {
	state.queries = [];
	state.rows = () => [];
	const before = Date.now();

	const response = await get();
	assert.equal(response.status, 200);
	const choreQuery = state.queries.find((query) => query.table === 'chores');
	assert.deepEqual(choreQuery?.orderBy?.op, 'asc');
	assert.deepEqual(choreQuery?.orderBy?.args, ['chores.nextDueAt']);
	const [wgScope, overdue] = (choreQuery?.where?.args ?? []) as SqlNode[];
	assert.equal(choreQuery?.where?.op, 'and');
	assert.deepEqual([wgScope?.op, ...(wgScope?.args ?? [])], ['eq', 'chores.wgId', 'wg-1']);
	assert.deepEqual([overdue?.op, overdue?.args[0]], ['lte', 'chores.nextDueAt']);
	const cutoff = overdue?.args[1] as Date;
	assert.ok(cutoff.getTime() >= before && cutoff.getTime() <= Date.now(), 'cut off at now');
	assert.equal(choreQuery?.limit, 120);
});

test('reminders read open shopping items and open announcements from their own oldest-first queries', async () => {
	const at = new Date('2026-01-01T00:00:00.000Z');
	// The newest-first timeline rows are all bought items / system notices.
	const timelineShopping = Array.from({ length: 120 }, (_, index) => ({
		id: `bought-${index}`,
		addedByMemberId: 'member-1',
		name: 'Milch',
		createdAt: at,
		boughtAt: at,
	}));
	const timelineAnnouncements = Array.from({ length: 120 }, (_, index) => ({
		id: `notice-${index}`,
		authorMemberId: 'member-1',
		content: 'Notice',
		kind: 'info',
		status: 'open',
		createdAt: at,
		source: 'system',
	}));
	const openShopping = [{ id: 'open-item', name: 'Brot', createdAt: at }];
	const openAnnouncements = [{ id: 'open-question', content: 'Wer?', kind: 'question', createdAt: at }];
	state.queries = [];
	state.rows = (query) => {
		if (query.table === 'shoppingItems') {
			return hasOp(query.where, 'isNull') ? openShopping : timelineShopping;
		}
		if (query.table === 'announcements') {
			return hasOp(query.where, 'inArray') ? openAnnouncements : timelineAnnouncements;
		}
		return [];
	};

	const response = await get();
	assert.equal(response.status, 200);
	const { reminders } = (await response.json()) as { reminders: { href: string }[] };
	assert.deepEqual(
		reminders.map((reminder) => reminder.href),
		['/pinnwand#announcement-open-question', '/einkauf?highlight=open-item'],
	);

	const openShoppingQuery = state.queries.find(
		(query) => query.table === 'shoppingItems' && hasOp(query.where, 'isNull'),
	);
	assert.deepEqual(
		(openShoppingQuery?.where?.args as SqlNode[]).map((part) => [part.op, ...part.args]),
		[
			['eq', 'shoppingItems.wgId', 'wg-1'],
			['isNull', 'shoppingItems.boughtAt'],
		],
	);
	assert.deepEqual(
		[openShoppingQuery?.orderBy?.op, ...(openShoppingQuery?.orderBy?.args ?? [])],
		['asc', 'shoppingItems.createdAt'],
	);
	assert.equal(openShoppingQuery?.limit, 120);

	const openAnnouncementQuery = state.queries.find(
		(query) => query.table === 'announcements' && hasOp(query.where, 'inArray'),
	);
	assert.deepEqual(
		(openAnnouncementQuery?.where?.args as SqlNode[]).map((part) => [part.op, ...part.args]),
		[
			['eq', 'announcements.wgId', 'wg-1'],
			['eq', 'announcements.status', 'open'],
			['inArray', 'announcements.kind', ['question', 'problem', 'request']],
		],
	);
	assert.deepEqual(
		[openAnnouncementQuery?.orderBy?.op, ...(openAnnouncementQuery?.orderBy?.args ?? [])],
		['asc', 'announcements.createdAt'],
	);
	assert.equal(openAnnouncementQuery?.limit, 120);
});

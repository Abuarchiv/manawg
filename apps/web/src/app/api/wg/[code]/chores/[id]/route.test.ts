import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import {
	type SqlNode,
	mockDrizzle,
	rowMatches,
} from '../../../../../../../tests/support/drizzle-mock';
import {
	SHARE_CODE,
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';

const choreId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const otherWgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const chores = { id: 'id', wgId: 'wgId' };
const CHORE = {
	id: choreId,
	wgId,
	title: 'Küche reinigen',
	assignedMemberId: null,
	nextDueAt: new Date('2026-09-27T10:00:00.000Z'),
	intervalDays: 7,
	recurrenceType: 'days',
};

const state = {
	rows: [CHORE] as (typeof CHORE)[],
	queries: [] as { table: unknown; conditions: SqlNode; limit: number }[],
};

mockDrizzle();
mockObservability();
mockRateLimit();
const member = mockWgMember({ wg: { id: wgId }, member: { memberId: choreId, name: 'Alex' } });
mockDb({
	chores,
	db: {
		select: () => ({
			from: (table: unknown) => ({
				where: (conditions: SqlNode) => ({
					limit: async (limit: number) => {
						state.queries.push({ table, conditions, limit });
						return state.rows.filter((row) => rowMatches(row, conditions)).slice(0, limit);
					},
				}),
			}),
		}),
	},
});
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/guards/admin', { namedExports: { isWgAdmin: async () => true } });

const { GET } = await import('./route');

function given(rows: (typeof CHORE)[] = [CHORE], denied: Response | null = null): void {
	state.rows = rows;
	state.queries = [];
	member.denied = denied;
	member.calls = [];
}

const get = (id = choreId) =>
	GET(request(`/api/wg/${SHARE_CODE}/chores/${choreId}`), routeCtx({ id }));

test('GET returns the chore needed by the MCP detail reader and scopes by id and WG', async () => {
	given();

	const response = await get();

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { chore: JSON.parse(JSON.stringify(CHORE)) });
	assert.equal(member.calls.length, 1);
	assert.deepEqual(
		state.queries[0]?.conditions.args.map((part) => (part as SqlNode).args),
		[
			['id', choreId],
			['wgId', wgId],
		],
	);
	assert.equal(state.queries[0]?.limit, 1);
});

test('GET returns not found for a chore id that belongs to another WG', async () => {
	given([{ ...CHORE, wgId: otherWgId }]);

	const response = await get();

	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: 'chore_not_found' });
	assert.equal(state.queries.length, 1);
});

test('GET requires WG membership before querying chores', async () => {
	given([CHORE], Response.json({ error: 'not_a_member' }, { status: 403 }));

	const response = await get();

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: 'not_a_member' });
	assert.equal(state.queries.length, 0);
});

test('GET rejects a malformed UUID before auth or database access', async () => {
	given();

	const response = await get('not-a-uuid');

	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'id_invalid' });
	assert.equal(member.calls.length, 0);
	assert.equal(state.queries.length, 0);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockDb } from '../../../../../../../tests/support/db-mock';
import { mockDrizzle, project, rowMatches } from '../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../tests/support/route-harness';

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const MOVED_OUT = '22222222-2222-4222-8222-222222222222';

const wgMembers = { id: 'id', name: 'name', wgId: 'wgId', deactivatedAt: 'deactivatedAt' };
// The route must only ever offer active members.
const memberRows = [
	{ id: ACTIVE, name: 'Alex', wgId: 'wg', deactivatedAt: null },
	{ id: MOVED_OUT, name: 'Sam', wgId: 'wg', deactivatedAt: new Date('2026-01-01') },
];

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: 'wg' }, member: { memberId: ACTIVE, name: 'Alex' } });
mockDb({
	wgMembers,
	db: {
		select: (fields: Record<string, unknown>) => ({
			from: () => ({
				where: async (predicate: unknown) =>
					project(
						memberRows.filter((row) => rowMatches(row, predicate)),
						fields,
					),
			}),
		}),
	},
});

const { POST } = await import('./route');

// Alex paid, Sam owes half.
const CSV = ['Date,Description,Cost,Currency,Alex,Sam', '2026-01-15,Miete,30.00,EUR,15.00,-15.00'].join(
	'\n',
);

async function preview(memberMapping: Record<string, string>) {
	const response = await POST(
		request('/api/wg/MTE8PZAT/imports/preview', {
			method: 'POST',
			body: { source: 'splitwise_csv', payload: CSV, memberMapping },
		}),
		routeCtx(),
	);
	return response.json();
}

test('preview rejects a mapping to a moved-out member as a conflict', async () => {
	const body = await preview({ Sam: MOVED_OUT });
	assert.deepEqual(body.members, [{ id: ACTIVE, name: 'Alex' }]);
	assert.equal(body.memberMapping.Sam, null);
	assert.equal(body.memberMapping.Alex, ACTIVE);
	assert.deepEqual(body.conflicts, ['Sam']);
});

test('preview rejects unknown member ids and keeps valid ones', async () => {
	const body = await preview({ Sam: 'not-a-member', Alex: ACTIVE });
	assert.deepEqual(body.conflicts, ['Sam']);
	const clean = await preview({ Sam: ACTIVE });
	assert.deepEqual(clean.conflicts, []);
});

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { ClaimTable, idempotencyResponses } from '../../../tests/support/claim-table';
import { mockDrizzle } from '../../../tests/support/drizzle-mock';
import { TransactionAbort } from './transaction-abort';

// The claim helpers run against an in-memory claim table that evaluates their predicates.

const scope = 'chores-create:wg-1:member-1';
const key = '11111111-1111-4111-8111-111111111111';

const state = {
	table: new ClaimTable(),
	logged: [] as string[],
	releaseError: null as Error | null,
};

function given(row: { responseBody: unknown; expiresAt: Date } | null): ClaimTable {
	state.table = new ClaimTable();
	state.table.jsonb = false;
	state.logged = [];
	state.releaseError = null;
	if (row) state.table.put({ scope, key, ...row });
	return state.table;
}

mockDrizzle();
mock.module('@/core/db', {
	namedExports: {
		idempotencyResponses,
		db: {
			delete: () => {
				if (state.releaseError) {
					const error = state.releaseError;
					return {
						where: () => ({
							returning: async () => {
								throw error;
							},
						}),
					};
				}
				return state.table.delete();
			},
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (label: string) => {
			state.logged.push(label);
		},
	},
});

const { completeClaimedResponse, lockClaimedResponse, releaseClaimedResponse, releaseLockedClaim } =
	await import('./claimed-response');

/** The transaction handle the helpers write through. */
const tx = {
	select: (columns: Record<string, unknown>) => state.table.select(columns),
	update: () => state.table.update(),
	delete: () => state.table.delete(),
} as never;

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const isChoreBody = (body: unknown): body is { chore: unknown } =>
	body !== null && typeof body === 'object' && 'chore' in body;

test('lock aborts when the claim row is missing', async () => {
	given(null);
	const error = await lockClaimedResponse(tx, scope, key, isChoreBody).catch((e: unknown) => e);
	assert.ok(error instanceof TransactionAbort);
	assert.equal(error.code, 'idempotency_claim_missing');
});

test('lock aborts on an expired placeholder', async () => {
	given({ responseBody: { _claimed: true }, expiresAt: inMinutes(-1) });
	const error = await lockClaimedResponse(tx, scope, key, isChoreBody).catch((e: unknown) => e);
	assert.ok(error instanceof TransactionAbort);
	assert.equal(error.code, 'idempotency_claim_invalid');
});

test('lock aborts on a foreign body or a placeholder with extra keys', async () => {
	for (const responseBody of [
		{ status: 200 },
		{ _claimed: true, extra: 1 },
		{ _claimed: 'true' },
		[{ _claimed: true }],
		null,
	]) {
		given({ responseBody, expiresAt: inMinutes(10) });
		await assert.rejects(lockClaimedResponse(tx, scope, key, isChoreBody), {
			message: 'idempotency_claim_invalid',
		});
	}
});

test('lock replays a completed response, even after its replay window', async () => {
	const body = { chore: { id: 'chore-1' }, warning: null };
	const table = given({ responseBody: body, expiresAt: inMinutes(-1) });
	assert.deepEqual(await lockClaimedResponse(tx, scope, key, isChoreBody), {
		kind: 'completed',
		body,
	});
	assert.deepEqual(table.locks, ['update']);
});

test('lock returns the lease of a valid placeholder', async () => {
	const lease = inMinutes(15);
	given({ responseBody: { _claimed: true }, expiresAt: lease });
	assert.deepEqual(await lockClaimedResponse(tx, scope, key, isChoreBody), {
		kind: 'claimed',
		leaseExpiresAt: lease,
	});
});

test('completion stores the response for the replay window when the lease matches', async () => {
	const lease = inMinutes(15);
	const table = given({ responseBody: { _claimed: true }, expiresAt: lease });
	const body = { chore: { id: 'chore-1' }, warning: null };
	await completeClaimedResponse(tx, scope, key, body, lease);
	assert.deepEqual(table.slot?.responseBody, body);
	assert.ok((table.slot?.expiresAt.getTime() ?? 0) > Date.now() + 6 * 24 * 60 * 60 * 1000);
});

test('completion with a lease taken over by another request aborts and writes nothing', async () => {
	const theirLease = inMinutes(15);
	const table = given({ responseBody: { _claimed: true }, expiresAt: theirLease });
	await assert.rejects(completeClaimedResponse(tx, scope, key, { chore: {} }, inMinutes(5)), {
		message: 'idempotency_claim_missing',
	});
	assert.deepEqual(table.slot, {
		scope,
		key,
		responseBody: { _claimed: true },
		expiresAt: theirLease,
	});
});

test('completion never overwrites a stored response or an expired placeholder', async () => {
	for (const row of [
		{ responseBody: { chore: { id: 'other' } }, expiresAt: inMinutes(60) },
		{ responseBody: { _claimed: true }, expiresAt: inMinutes(-1) },
	]) {
		const table = given(row);
		await assert.rejects(completeClaimedResponse(tx, scope, key, { chore: {} }, row.expiresAt), {
			message: 'idempotency_claim_missing',
		});
		assert.deepEqual(table.slot?.responseBody, row.responseBody);
	}
});

test('release deletes only its own placeholder', async () => {
	const lease = inMinutes(15);
	const own = given({ responseBody: { _claimed: true }, expiresAt: lease });
	assert.equal(await releaseClaimedResponse(scope, key, lease), true);
	assert.deepEqual(own.rows, []);

	const reclaimed = given({ responseBody: { _claimed: true }, expiresAt: inMinutes(14) });
	assert.equal(await releaseClaimedResponse(scope, key, lease), false);
	assert.equal(reclaimed.rows.length, 1);

	const completed = given({ responseBody: { chore: { id: 'c' } }, expiresAt: lease });
	assert.equal(await releaseClaimedResponse(scope, key, lease), false);
	assert.equal(completed.rows.length, 1);
});

test('release swallows database errors and reports nothing removed', async () => {
	given(null);
	state.releaseError = new Error('connection reset');
	assert.equal(await releaseClaimedResponse(scope, key, inMinutes(15)), false);
	assert.deepEqual(state.logged, ['[idempotency] claim release failed']);
});

test('in-transaction release removes the locked placeholder or aborts', async () => {
	const lease = inMinutes(15);
	const own = given({ responseBody: { _claimed: true }, expiresAt: lease });
	await releaseLockedClaim(tx, scope, key, lease);
	assert.deepEqual(own.rows, []);

	const reclaimed = given({ responseBody: { _claimed: true }, expiresAt: inMinutes(14) });
	await assert.rejects(releaseLockedClaim(tx, scope, key, lease), {
		message: 'idempotency_claim_missing',
	});
	assert.equal(reclaimed.rows.length, 1);
});

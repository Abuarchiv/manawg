import assert from 'node:assert/strict';
import test from 'node:test';
import { loadClaimedResponse } from '../../../tests/support/claimed-response.cjs';

const scope = 'chores-create:wg-1:member-1';
const key = '11111111-1111-4111-8111-111111111111';
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'responseBody',
	expiresAt: 'expiresAt',
};
const PLACEHOLDER_SQL = `= '{"_claimed":true}'::jsonb`;
const NOT_EXPIRED_SQL = '> now()';

class TransactionAbort extends Error {
	constructor(code) {
		super(code);
		this.code = code;
	}
}

// Conditions stay data, so the fake table can evaluate the helpers' predicates.
const drizzle = {
	and: (...parts) => ({ op: 'and', parts: parts.filter(Boolean) }),
	eq: (column, value) => ({ op: 'eq', column, value }),
	sql: (strings, ...values) => ({ op: 'sql', text: strings.join(''), column: values[0] }),
};

function sameValue(left, right) {
	if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
	return left === right;
}

function matches(row, condition) {
	if (condition.op === 'and') return condition.parts.every((part) => matches(row, part));
	if (condition.op === 'eq') return sameValue(row[condition.column], condition.value);
	if (condition.text.includes(PLACEHOLDER_SQL)) {
		return JSON.stringify(row[condition.column]) === JSON.stringify({ _claimed: true });
	}
	if (condition.text.includes(NOT_EXPIRED_SQL)) return row[condition.column] > new Date();
	throw new Error(`unexpected sql: ${condition.text}`);
}

function harness(row) {
	const state = { rows: row ? [{ scope, key, ...row }] : [], locks: [], logged: [] };
	const where = (condition) => state.rows.filter((candidate) => matches(candidate, condition));
	const deleteFrom = () => ({
		where: (condition) => ({
			returning: async () => {
				const removed = where(condition);
				state.rows = state.rows.filter((candidate) => !removed.includes(candidate));
				return removed.map((candidate) => ({ scope: candidate.scope }));
			},
		}),
	});
	const tx = {
		select: (columns) => ({
			from: () => ({
				where: (condition) => ({
					limit: () => ({
						for: async (lock) => {
							state.locks.push(lock);
							return where(condition).map((candidate) => ({
								body: candidate[columns.body],
								expiresAt: candidate[columns.expiresAt],
							}));
						},
					}),
				}),
			}),
		}),
		update: () => ({
			set: (values) => ({
				where: (condition) => ({
					returning: async () => {
						const updated = where(condition);
						for (const candidate of updated) {
							candidate.responseBody = values.responseBody;
							candidate.expiresAt = values.expiresAt;
						}
						return updated.map((candidate) => ({ scope: candidate.scope }));
					},
				}),
			}),
		}),
		delete: deleteFrom,
	};
	const helpers = loadClaimedResponse({
		'@/core/db': { db: { delete: deleteFrom }, idempotencyResponses },
		'@/core/db/transaction': { TransactionAbort },
		'@/core/infra/observability': { logApiError: (label) => state.logged.push(label) },
		'drizzle-orm': drizzle,
	});
	return { state, tx, helpers };
}

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000);
const isChoreBody = (body) => body !== null && typeof body === 'object' && 'chore' in body;

test('lock aborts when the claim row is missing', async () => {
	const { tx, helpers } = harness(null);
	const error = await helpers.lockClaimedResponse(tx, scope, key, isChoreBody).catch((e) => e);
	assert.ok(error instanceof TransactionAbort);
	assert.equal(error.code, 'idempotency_claim_missing');
});

test('lock aborts on an expired placeholder', async () => {
	const { tx, helpers } = harness({ responseBody: { _claimed: true }, expiresAt: inMinutes(-1) });
	const error = await helpers.lockClaimedResponse(tx, scope, key, isChoreBody).catch((e) => e);
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
		const { tx, helpers } = harness({ responseBody, expiresAt: inMinutes(10) });
		await assert.rejects(helpers.lockClaimedResponse(tx, scope, key, isChoreBody), {
			message: 'idempotency_claim_invalid',
		});
	}
});

test('lock replays a completed response, even after its replay window', async () => {
	const body = { chore: { id: 'chore-1' }, warning: null };
	const { state, tx, helpers } = harness({ responseBody: body, expiresAt: inMinutes(-1) });
	assert.deepEqual(await helpers.lockClaimedResponse(tx, scope, key, isChoreBody), {
		kind: 'completed',
		body,
	});
	assert.deepEqual(state.locks, ['update']);
});

test('lock returns the lease of a valid placeholder', async () => {
	const lease = inMinutes(15);
	const { tx, helpers } = harness({ responseBody: { _claimed: true }, expiresAt: lease });
	assert.deepEqual(await helpers.lockClaimedResponse(tx, scope, key, isChoreBody), {
		kind: 'claimed',
		leaseExpiresAt: lease,
	});
});

test('completion stores the response for the replay window when the lease matches', async () => {
	const lease = inMinutes(15);
	const { state, tx, helpers } = harness({ responseBody: { _claimed: true }, expiresAt: lease });
	const body = { chore: { id: 'chore-1' }, warning: null };
	await helpers.completeClaimedResponse(tx, scope, key, body, lease);
	assert.deepEqual(state.rows[0].responseBody, body);
	assert.ok(state.rows[0].expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
});

test('completion with a lease taken over by another request aborts and writes nothing', async () => {
	const theirLease = inMinutes(15);
	const { state, tx, helpers } = harness({
		responseBody: { _claimed: true },
		expiresAt: theirLease,
	});
	await assert.rejects(
		helpers.completeClaimedResponse(tx, scope, key, { chore: {} }, inMinutes(5)),
		{ message: 'idempotency_claim_missing' },
	);
	assert.deepEqual(state.rows[0], {
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
		const { state, tx, helpers } = harness(row);
		await assert.rejects(helpers.completeClaimedResponse(tx, scope, key, { chore: {} }), {
			message: 'idempotency_claim_missing',
		});
		assert.deepEqual(state.rows[0].responseBody, row.responseBody);
	}
});

test('release deletes only its own placeholder', async () => {
	const lease = inMinutes(15);
	const own = harness({ responseBody: { _claimed: true }, expiresAt: lease });
	assert.equal(await own.helpers.releaseClaimedResponse(scope, key, lease), true);
	assert.deepEqual(own.state.rows, []);

	const reclaimed = harness({ responseBody: { _claimed: true }, expiresAt: inMinutes(14) });
	assert.equal(await reclaimed.helpers.releaseClaimedResponse(scope, key, lease), false);
	assert.equal(reclaimed.state.rows.length, 1);

	const completed = harness({ responseBody: { chore: { id: 'c' } }, expiresAt: lease });
	assert.equal(await completed.helpers.releaseClaimedResponse(scope, key, lease), false);
	assert.equal(completed.state.rows.length, 1);
});

test('release swallows database errors and reports nothing removed', async () => {
	const { state, helpers } = loadFailingRelease();
	assert.equal(await helpers.releaseClaimedResponse(scope, key, inMinutes(15)), false);
	assert.deepEqual(state.logged, ['[idempotency] claim release failed']);
});

function loadFailingRelease() {
	const state = { logged: [] };
	const helpers = loadClaimedResponse({
		'@/core/db': {
			db: {
				delete: () => ({
					where: () => ({
						returning: async () => {
							throw new Error('connection reset');
						},
					}),
				}),
			},
			idempotencyResponses,
		},
		'@/core/db/transaction': { TransactionAbort },
		'@/core/infra/observability': { logApiError: (label) => state.logged.push(label) },
		'drizzle-orm': drizzle,
	});
	return { state, helpers };
}

test('in-transaction release removes the locked placeholder or aborts', async () => {
	const lease = inMinutes(15);
	const own = harness({ responseBody: { _claimed: true }, expiresAt: lease });
	await own.helpers.releaseLockedClaim(own.tx, scope, key, lease);
	assert.deepEqual(own.state.rows, []);

	const reclaimed = harness({ responseBody: { _claimed: true }, expiresAt: inMinutes(14) });
	await assert.rejects(reclaimed.helpers.releaseLockedClaim(reclaimed.tx, scope, key, lease), {
		message: 'idempotency_claim_missing',
	});
	assert.equal(reclaimed.state.rows.length, 1);
});

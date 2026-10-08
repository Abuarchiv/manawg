import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from './transaction-abort';

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

type Row = Record<string, unknown>;
type Condition =
	| { op: 'and'; parts: Condition[] }
	| { op: 'eq'; column: string; value: unknown }
	| { op: 'sql'; text: string; column: string };

// Conditions stay data, so the fake table can evaluate the helpers' predicates. The `sql` tag
// keeps the template text: the fake recognises the two predicates the helpers build by their
// text (placeholder body, not expired).
const drizzle = {
	and: (...parts: Array<Condition | undefined>): Condition => ({
		op: 'and',
		parts: parts.filter((part): part is Condition => Boolean(part)),
	}),
	eq: (column: string, value: unknown): Condition => ({ op: 'eq', column, value }),
	sql: (strings: TemplateStringsArray, ...values: string[]): Condition => ({
		op: 'sql',
		text: strings.join(''),
		column: values[0] ?? '',
	}),
};

// The mocks are bound once; each test points them at its own fake database.
let active: { deleteFrom: () => unknown; logged: string[] };

mock.module('drizzle-orm', { namedExports: drizzle });
mock.module('@/core/db', {
	namedExports: { db: { delete: () => active.deleteFrom() }, idempotencyResponses },
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: (label: string) => active.logged.push(label) },
});

const { completeClaimedResponse, lockClaimedResponse, releaseClaimedResponse, releaseLockedClaim } =
	await import('./claimed-response');

function sameValue(left: unknown, right: unknown): boolean {
	if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
	return left === right;
}

function matches(row: Row, condition: Condition): boolean {
	if (condition.op === 'and') return condition.parts.every((part) => matches(row, part));
	if (condition.op === 'eq') return sameValue(row[condition.column], condition.value);
	if (condition.text.includes(PLACEHOLDER_SQL)) {
		return JSON.stringify(row[condition.column]) === JSON.stringify({ _claimed: true });
	}
	if (condition.text.includes(NOT_EXPIRED_SQL)) return (row[condition.column] as Date) > new Date();
	throw new Error(`unexpected sql: ${condition.text}`);
}

function harness(row: Row | null, options: { failRelease?: boolean } = {}) {
	const state = {
		rows: (row ? [{ scope, key, ...row }] : []) as Row[],
		locks: [] as string[],
		logged: [] as string[],
	};
	const where = (condition: Condition) =>
		state.rows.filter((candidate) => matches(candidate, condition));
	const deleteFrom = () => ({
		where: (condition: Condition) => ({
			returning: async () => {
				if (options.failRelease) throw new Error('connection reset');
				const removed = where(condition);
				state.rows = state.rows.filter((candidate) => !removed.includes(candidate));
				return removed.map((candidate) => ({ scope: candidate.scope }));
			},
		}),
	});
	const tx = {
		select: (columns: Record<string, string>) => ({
			from: () => ({
				where: (condition: Condition) => ({
					limit: () => ({
						for: async (lock: string) => {
							state.locks.push(lock);
							return where(condition).map((candidate) => ({
								body: candidate[columns.body as string],
								expiresAt: candidate[columns.expiresAt as string],
							}));
						},
					}),
				}),
			}),
		}),
		update: () => ({
			set: (values: Row) => ({
				where: (condition: Condition) => ({
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
	} as never;
	active = { deleteFrom, logged: state.logged };
	const helpers = {
		lockClaimedResponse,
		completeClaimedResponse,
		releaseClaimedResponse,
		releaseLockedClaim,
	};
	return { state, tx, helpers };
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const isChoreBody = (body: unknown): body is { chore: unknown } =>
	body !== null && typeof body === 'object' && 'chore' in body;

test('lock aborts when the claim row is missing', async () => {
	const { tx, helpers } = harness(null);
	const error = await helpers
		.lockClaimedResponse(tx, scope, key, isChoreBody)
		.catch((e: unknown) => e);
	assert.ok(error instanceof TransactionAbort);
	assert.equal(error.code, 'idempotency_claim_missing');
});

test('lock aborts on an expired placeholder', async () => {
	const { tx, helpers } = harness({ responseBody: { _claimed: true }, expiresAt: inMinutes(-1) });
	const error = await helpers
		.lockClaimedResponse(tx, scope, key, isChoreBody)
		.catch((e: unknown) => e);
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
	assert.deepEqual(state.rows[0]?.responseBody, body);
	assert.ok((state.rows[0]?.expiresAt as Date).getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
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
		await assert.rejects(
			helpers.completeClaimedResponse(tx, scope, key, { chore: {} }, undefined as unknown as Date),
			{
				message: 'idempotency_claim_missing',
			},
		);
		assert.deepEqual(state.rows[0]?.responseBody, row.responseBody);
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
	const { state, helpers } = harness(null, { failRelease: true });
	assert.equal(await helpers.releaseClaimedResponse(scope, key, inMinutes(15)), false);
	assert.deepEqual(state.logged, ['[idempotency] claim release failed']);
});

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

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

// The primitive runs against an in-memory claim table that follows the real claim helpers'
// rules (placeholder, lease, expiry); transactions snapshot the table and restore it on throw.

const SCOPE = 'chores-create:wg-1:member-1';
const KEY = '11111111-1111-4111-8111-111111111111';
const LEASE_MS = 15 * 60 * 1000;
const PLACEHOLDER = { _claimed: true };

interface Row {
	body: unknown;
	expiresAt: Date;
}

const state = {
	rows: new Map<string, Row>(),
	writes: [] as string[],
	claimError: null as Error | null,
	readError: null as Error | null,
	released: [] as Date[],
	transactions: 0,
	warned: 0,
	/** Rows changed by another request meanwhile; they survive this request's rollback. */
	external: new Map<string, Row>(),
};

function reset(): void {
	state.rows = new Map();
	state.writes = [];
	state.claimError = null;
	state.readError = null;
	state.released = [];
	state.transactions = 0;
	state.warned = 0;
	state.external = new Map();
}

const id = (scope: string, key: string) => `${scope}|${key}`;
const isPlaceholder = (body: unknown) => JSON.stringify(body) === JSON.stringify(PLACEHOLDER);
const live = (row: Row | undefined) => row !== undefined && row.expiresAt > new Date();

mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async (scope: string, key: string) => {
			if (state.claimError) throw state.claimError;
			const row = state.rows.get(id(scope, key));
			if (live(row)) return null;
			const expiresAt = new Date(Date.now() + LEASE_MS);
			state.rows.set(id(scope, key), { body: PLACEHOLDER, expiresAt });
			return expiresAt;
		},
		getCachedResponse: async (scope: string, key: string) => {
			if (state.readError) throw state.readError;
			const row = state.rows.get(id(scope, key));
			if (!row || !live(row) || isPlaceholder(row.body)) return null;
			if ((row.body as { _replayUnavailable?: boolean })._replayUnavailable) {
				throw new Error('idempotency_response_unavailable');
			}
			return row.body;
		},
	},
});

mock.module('@/core/db/claimed-response', {
	namedExports: {
		lockClaimedResponse: async (
			_tx: unknown,
			scope: string,
			key: string,
			isCompleted: (body: unknown) => boolean,
		) => {
			const row = state.rows.get(id(scope, key));
			if (!row) throw new TransactionAbort('idempotency_claim_missing');
			if (isCompleted(row.body)) return { kind: 'completed', body: row.body };
			if (!isPlaceholder(row.body) || !live(row)) {
				throw new TransactionAbort('idempotency_claim_invalid');
			}
			return { kind: 'claimed', leaseExpiresAt: row.expiresAt };
		},
		completeClaimedResponse: async (
			_tx: unknown,
			scope: string,
			key: string,
			body: object,
			lease: Date,
		) => {
			const row = state.rows.get(id(scope, key));
			if (
				!row ||
				!isPlaceholder(row.body) ||
				!live(row) ||
				row.expiresAt.getTime() !== lease.getTime()
			) {
				throw new TransactionAbort('idempotency_claim_missing');
			}
			state.rows.set(id(scope, key), { body, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
		},
		releaseLockedClaim: async (_tx: unknown, scope: string, key: string, lease: Date) => {
			const row = state.rows.get(id(scope, key));
			if (!row || !isPlaceholder(row.body) || row.expiresAt.getTime() !== lease.getTime()) {
				throw new TransactionAbort('idempotency_claim_missing');
			}
			state.rows.delete(id(scope, key));
		},
		releaseClaimedResponse: async (scope: string, key: string, lease: Date) => {
			state.released.push(lease);
			const row = state.rows.get(id(scope, key));
			if (!row || !isPlaceholder(row.body) || row.expiresAt.getTime() !== lease.getTime()) {
				return false;
			}
			state.rows.delete(id(scope, key));
			return true;
		},
	},
});

mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction: async <R>(work: (tx: unknown) => Promise<R>): Promise<R> => {
			state.transactions += 1;
			const snapshot = new Map(state.rows);
			const writes = [...state.writes];
			try {
				return await work({ tx: state.transactions });
			} catch (err) {
				state.rows = snapshot;
				for (const [rowId, row] of state.external) state.rows.set(rowId, row);
				state.writes = writes;
				throw err;
			}
		},
	},
});

mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
});

const { bodyCodec, responseCodec, withIdempotentWrite } = await import(
	'../src/core/db/idempotent-write.ts'
);

type Body = { chore: { id: string } };
const isBody = (value: unknown): value is Body =>
	value !== null && typeof value === 'object' && 'chore' in value;
const codec = bodyCodec(isBody);

function createChore(choreId = 'chore-1') {
	return async () => {
		state.writes.push(choreId);
		return { status: 200, body: { chore: { id: choreId } }, context: { choreId } };
	};
}

test('without a key the write runs once in a plain transaction', async () => {
	reset();
	const result = await withIdempotentWrite({ scope: SCOPE, key: null, codec }, createChore());
	assert.deepEqual(result, {
		kind: 'written',
		status: 200,
		body: { chore: { id: 'chore-1' } },
		context: { choreId: 'chore-1' },
	});
	assert.deepEqual(state.writes, ['chore-1']);
	assert.equal(state.rows.size, 0);
});

test('the first keyed write stores its response in the write transaction', async () => {
	reset();
	const result = await withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore());
	assert.equal(result.kind, 'written');
	assert.equal(state.transactions, 1);
	assert.deepEqual(state.rows.get(id(SCOPE, KEY))?.body, { chore: { id: 'chore-1' } });
});

test('a retry with the same key replays the stored response without writing or preparing', async () => {
	reset();
	await withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore());
	let prepared = 0;
	const replay = await withIdempotentWrite(
		{
			scope: SCOPE,
			key: KEY,
			codec,
			prepare: async () => {
				prepared += 1;
				return { input: undefined };
			},
		},
		createChore('chore-2'),
	);
	assert.deepEqual(replay, { kind: 'replayed', status: 200, body: { chore: { id: 'chore-1' } } });
	assert.equal(prepared, 0);
	assert.deepEqual(state.writes, ['chore-1']);
});

test('prepare can stop the request before anything is claimed', async () => {
	reset();
	const result = await withIdempotentWrite(
		{ scope: SCOPE, key: KEY, codec, prepare: async () => ({ stop: 'rate_limited' }) },
		createChore(),
	);
	assert.deepEqual(result, { kind: 'stopped', response: 'rate_limited' });
	assert.equal(state.rows.size, 0);
	assert.deepEqual(state.writes, []);
});

test('prepare hands its input to the write', async () => {
	reset();
	const result = await withIdempotentWrite(
		{ scope: SCOPE, key: KEY, codec, prepare: async () => ({ input: 'chore-7' }) },
		async (_tx, choreId: string) => ({ status: 200, body: { chore: { id: choreId } } }),
	);
	assert.deepEqual(result.kind === 'written' && result.body, { chore: { id: 'chore-7' } });
});

test('a concurrent loser waits for the winner and replays its response', async () => {
	reset();
	let finishWinner: () => void = () => undefined;
	const winnerMayFinish = new Promise<void>((resolve) => {
		finishWinner = resolve;
	});
	const winner = withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, async () => {
		await winnerMayFinish;
		state.writes.push('winner');
		return { status: 200, body: { chore: { id: 'winner' } } };
	});
	await new Promise((resolve) => setImmediate(resolve));
	const loser = withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore('loser'));
	setTimeout(finishWinner, 20);
	const [won, lost] = await Promise.all([winner, loser]);
	assert.equal(won.kind, 'written');
	assert.deepEqual(lost, { kind: 'replayed', status: 200, body: { chore: { id: 'winner' } } });
	assert.deepEqual(state.writes, ['winner']);
});

test('a lost claim runs beforeReplay, which may answer instead of the stored response', async () => {
	reset();
	state.rows.set(id(SCOPE, KEY), {
		body: { chore: { id: 'chore-1' } },
		expiresAt: new Date(Date.now() + 60_000),
	});
	const result = await withIdempotentWrite(
		{ scope: SCOPE, key: KEY, codec, beforeReplay: async () => 'member_deactivated' },
		createChore('chore-2'),
	);
	assert.deepEqual(result, { kind: 'stopped', response: 'member_deactivated' });
});

test('a failed write rolls back and releases the claim with its lease', async () => {
	reset();
	await assert.rejects(
		withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, async () => {
			state.writes.push('half');
			throw new TransactionAbort('insert_failed');
		}),
		(err: unknown) => err instanceof TransactionAbort && err.code === 'insert_failed',
	);
	assert.deepEqual(state.writes, []);
	assert.equal(state.released.length, 1);
	assert.equal(state.rows.size, 0);

	const retry = await withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore());
	assert.equal(retry.kind, 'written');
});

test('a rejected outcome is not stored and frees the key in the same transaction', async () => {
	reset();
	const rejected = await withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, async () => ({
		status: 429,
		body: { chore: { id: 'none' } },
	}));
	assert.equal(rejected.kind, 'written');
	assert.equal(rejected.status, 429);
	assert.equal(state.rows.size, 0);
	assert.equal(state.released.length, 0);
});

test('storeStatus keeps chosen non-2xx outcomes for replay', async () => {
	reset();
	const options = {
		scope: SCOPE,
		key: KEY,
		codec: responseCodec(),
		storeStatus: (status: number) => status !== 429,
	};
	await withIdempotentWrite(options, async () => ({ status: 400, body: { error: 'bad' } }));
	const replay = await withIdempotentWrite(options, async () => ({ status: 200, body: {} }));
	assert.deepEqual(replay, { kind: 'replayed', status: 400, body: { error: 'bad' } });
});

test('an oversized response is stored as replay-unavailable', async () => {
	reset();
	const originalWarn = console.warn;
	console.warn = () => {
		state.warned += 1;
	};
	try {
		const big = 'x'.repeat(33 * 1024);
		const result = await withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, async () => ({
			status: 200,
			body: { chore: { id: big } },
		}));
		assert.equal(result.kind, 'written');
		assert.deepEqual(state.rows.get(id(SCOPE, KEY))?.body, { _replayUnavailable: true });
		assert.equal(state.warned, 1);
		await assert.rejects(
			withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore()),
			/idempotency_response_unavailable/,
		);

		reset();
		await withIdempotentWrite(
			{ scope: SCOPE, key: KEY, codec, maxStoredBytes: null },
			async () => ({ status: 200, body: { chore: { id: big } } }),
		);
		assert.deepEqual(state.rows.get(id(SCOPE, KEY))?.body, { chore: { id: big } });
	} finally {
		console.warn = originalWarn;
	}
});

test('claim and store errors fail closed without writing', async () => {
	reset();
	state.claimError = new Error('idempotency_claim_failed');
	await assert.rejects(
		withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore()),
		/idempotency_claim_failed/,
	);
	reset();
	state.readError = new Error('idempotency_cache_read_failed');
	await assert.rejects(
		withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore()),
		/idempotency_cache_read_failed/,
	);
	assert.deepEqual(state.writes, []);
});

test('a write whose lease expired cannot store its response and releases nothing it does not own', async () => {
	reset();
	await assert.rejects(
		withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, async () => {
			// Another request reclaims the key after this lease ran out.
			const reclaimed = { body: PLACEHOLDER, expiresAt: new Date(Date.now() + 2 * LEASE_MS) };
			state.rows.set(id(SCOPE, KEY), reclaimed);
			state.external.set(id(SCOPE, KEY), reclaimed);
			state.writes.push('late');
			return { status: 200, body: { chore: { id: 'late' } } };
		}),
		(err: unknown) => err instanceof TransactionAbort && err.code === 'idempotency_claim_missing',
	);
	assert.deepEqual(state.writes, []);
	assert.equal(state.released.length, 1);
	// The other request's placeholder survives the release.
	assert.ok(isPlaceholder(state.rows.get(id(SCOPE, KEY))?.body));
});

test('completeFailureCode maps a failed store to the route error code', async () => {
	reset();
	await assert.rejects(
		withIdempotentWrite(
			{ scope: SCOPE, key: KEY, codec, completeFailureCode: 'idempotency_response_write_failed' },
			async () => {
				state.rows.delete(id(SCOPE, KEY));
				return { status: 200, body: { chore: { id: 'x' } } };
			},
		),
		(err: unknown) =>
			err instanceof TransactionAbort && err.code === 'idempotency_response_write_failed',
	);
});

test('retryAfterRollback runs a second write under the same lease', async () => {
	reset();
	const duplicate = new Error('unique_violation');
	let attempts = 0;
	const result = await withIdempotentWrite(
		{
			scope: SCOPE,
			key: KEY,
			codec,
			retryAfterRollback: (error, attempt) =>
				error === duplicate && attempt === 1
					? async () => ({ status: 200, body: { chore: { id: 'existing' } } })
					: null,
		},
		async () => {
			attempts += 1;
			throw duplicate;
		},
	);
	assert.equal(attempts, 1);
	assert.deepEqual(result.kind === 'written' && result.body, { chore: { id: 'existing' } });
	assert.deepEqual(state.rows.get(id(SCOPE, KEY))?.body, { chore: { id: 'existing' } });
	assert.equal(state.released.length, 0);
});

test('inTransaction wraps the claim lock, e.g. for locks taken before it', async () => {
	reset();
	const order: string[] = [];
	await withIdempotentWrite(
		{
			scope: SCOPE,
			key: KEY,
			codec,
			inTransaction: async (work) => {
				order.push('payment-lock');
				return work({} as never);
			},
		},
		async () => {
			order.push('write');
			return { status: 200, body: { chore: { id: 'c' } } };
		},
	);
	assert.deepEqual(order, ['payment-lock', 'write']);
});

test('an unreadable stored response fails instead of replaying', async () => {
	reset();
	state.rows.set(id(SCOPE, KEY), { body: { other: true }, expiresAt: new Date(Date.now() + 1000) });
	await assert.rejects(
		withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore()),
		/idempotency_response_invalid/,
	);
});

test('responseCodec reads legacy rows through its fallback', () => {
	const legacy = responseCodec<unknown>((stored) =>
		'event' in stored ? { status: 200, body: stored } : null,
	);
	assert.deepEqual(legacy.decode({ status: 201, body: { a: 1 } }), { status: 201, body: { a: 1 } });
	assert.deepEqual(legacy.decode({ event: 1 }), { status: 200, body: { event: 1 } });
	assert.equal(legacy.decode({ other: 1 }), null);
	assert.deepEqual(legacy.encode({ status: 200, body: { a: 1 } }), { status: 200, body: { a: 1 } });
});

// Account deletion fences membership writes: a stored join response must not replay once the
// account is being deleted, but replays normally while the gate allows it.
test('a stored membership response is blocked when the account fence is present', async () => {
	reset();
	const join = { scope: 'wg-join:account', key: KEY, codec: responseCodec() };
	state.rows.set(id(join.scope, KEY), {
		body: { status: 200, body: { memberId: 'detached-member' } },
		expiresAt: new Date(Date.now() + 60_000),
	});
	let written = false;
	const blocked = await withIdempotentWrite(
		{ ...join, beforeReplay: async () => 'account_deletion_pending' },
		async () => {
			written = true;
			return { status: 200, body: { ok: true } };
		},
	);
	assert.deepEqual(blocked, { kind: 'stopped', response: 'account_deletion_pending' });
	assert.equal(written, false);

	const allowed = await withIdempotentWrite(
		{ ...join, beforeReplay: async () => null },
		async () => ({ status: 200, body: { ok: false } }),
	);
	assert.deepEqual(allowed, {
		kind: 'replayed',
		status: 200,
		body: { memberId: 'detached-member' },
	});
});

test('a 5xx outcome is not stored and the same key runs the write again', async () => {
	reset();
	const options = { scope: 'reminder:test', key: KEY, codec: responseCodec() };
	let calls = 0;
	const write = async () => {
		calls += 1;
		return calls === 1
			? { status: 500, body: { error: 'internal' } }
			: { status: 201, body: { ok: true } };
	};
	const first = await withIdempotentWrite(options, write);
	assert.equal(first.status, 500);
	assert.equal(state.rows.size, 0);

	const second = await withIdempotentWrite(options, write);
	assert.deepEqual([second.kind, second.status, second.body], ['written', 201, { ok: true }]);
	const replay = await withIdempotentWrite(options, write);
	assert.deepEqual(replay, { kind: 'replayed', status: 201, body: { ok: true } });
	assert.equal(calls, 2);
});

test('a transaction that fails before its callback releases the won claim', async () => {
	reset();
	const checkoutFailed = new Error('pool checkout timed out');
	await assert.rejects(
		withIdempotentWrite(
			{
				scope: SCOPE,
				key: KEY,
				codec,
				inTransaction: async () => {
					throw checkoutFailed;
				},
			},
			createChore(),
		),
		(err: unknown) => err === checkoutFailed,
	);
	assert.deepEqual(state.writes, []);
	assert.equal(state.released.length, 1);
	assert.equal(state.rows.size, 0);

	// The retry runs at once instead of polling into idempotency_response_pending.
	const retry = await withIdempotentWrite({ scope: SCOPE, key: KEY, codec }, createChore());
	assert.equal(retry.kind, 'written');
	assert.deepEqual(state.writes, ['chore-1']);
});

test('an unknown COMMIT outcome keeps the claim until its lease ends', async () => {
	reset();
	const commitFailed = new Error('connection lost during COMMIT');
	await assert.rejects(
		withIdempotentWrite(
			{
				scope: SCOPE,
				key: KEY,
				codec,
				inTransaction: async (work) => {
					await work({} as never);
					throw commitFailed;
				},
			},
			createChore(),
		),
		(err: unknown) => err === commitFailed,
	);
	assert.equal(state.released.length, 0);
});

test('without a key, retryAfterRollback recovers once without preparing again', async () => {
	reset();
	const duplicate = new Error('unique_violation');
	let prepared = 0;
	const result = await withIdempotentWrite(
		{
			scope: SCOPE,
			key: null,
			codec,
			prepare: async () => {
				prepared += 1;
				return { input: undefined };
			},
			retryAfterRollback: (error, attempt) =>
				error === duplicate && attempt === 1
					? async () => ({ status: 200, body: { chore: { id: 'existing' } } })
					: null,
		},
		async () => {
			throw duplicate;
		},
	);
	assert.equal(prepared, 1);
	assert.deepEqual(result.kind === 'written' && result.body, { chore: { id: 'existing' } });
});

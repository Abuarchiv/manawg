import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';

type Call = { kind: string; values?: unknown; query?: { sql: string; params: unknown[] } };

const state = {
	selects: [] as unknown[][],
	calls: [] as Call[],
	logged: [] as string[],
};

function render(condition: Parameters<PgDialect['sqlToQuery']>[0]): {
	sql: string;
	params: unknown[];
} {
	return new PgDialect().sqlToQuery(condition);
}

// Every query chain resolves through an async terminal (`limit`/`for`) that pops the next queued result.
function chain(): Record<string, unknown> {
	const self: Record<string, unknown> = {};
	for (const name of ['from', 'where', 'orderBy']) self[name] = () => self;
	self.limit = async () => state.selects.shift() ?? [];
	self.for = async () => {
		state.calls.push({ kind: 'lock-wg' });
		return [];
	};
	return self;
}

const tx = {
	select: () => chain(),
	update: () => ({
		set: (values: unknown) => ({
			where: async (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
				state.calls.push({ kind: 'update', values, query: render(condition) });
			},
		}),
	}),
	insert: () => ({
		values: async (values: unknown) => {
			state.calls.push({ kind: 'insert', values });
		},
	}),
};

mock.module('@/core/db', {
	namedExports: { db: { select: () => chain() } },
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: (message: string) => state.logged.push(message) },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		lockExpensePayments: async () => {
			state.calls.push({ kind: 'lock-payments' });
		},
		withTransaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
	},
});

const { ensureWgAdmin } = await import('./admin-succession');

function reset() {
	state.selects = [];
	state.calls = [];
	state.logged = [];
}

test('ensureWgAdmin demotes a placeholder admin before promoting the longest-standing member with an account', async () => {
	reset();
	state.selects = [[], [{ id: 'm2', name: 'Lena' }]];

	const result = await ensureWgAdmin(tx as never, 'wg-1');

	assert.deepEqual(result, { id: 'm2', name: 'Lena' });
	const updates = state.calls.filter((call) => call.kind === 'update');
	assert.equal(updates.length, 2);
	assert.deepEqual(updates[0]?.values, { role: 'member' });
	assert.match(updates[0]?.query?.sql ?? '', /"role" = \$2/);
	assert.deepEqual(updates[0]?.query?.params, ['wg-1', 'admin']);
	assert.deepEqual(updates[1]?.values, { role: 'admin' });
});

test('ensureWgAdmin leaves a WG alone while an active admin with an account exists', async () => {
	reset();
	state.selects = [[{ id: 'm1' }]];

	assert.equal(await ensureWgAdmin(tx as never, 'wg-1'), null);
	assert.deepEqual(state.calls, []);
});

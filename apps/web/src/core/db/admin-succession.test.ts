import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';

type Call = { kind: string; values?: unknown; query?: { sql: string; params: unknown[] } };

const state = {
	selects: [] as unknown[][],
	calls: [] as Call[],
};

function render(condition: Parameters<PgDialect['sqlToQuery']>[0]): {
	sql: string;
	params: unknown[];
} {
	return new PgDialect().sqlToQuery(condition);
}

// Every query chain resolves through an async terminal (`limit`) that pops the next queued result.
function chain(): Record<string, unknown> {
	const self: Record<string, unknown> = {};
	for (const name of ['from', 'where', 'orderBy']) self[name] = () => self;
	self.limit = async () => state.selects.shift() ?? [];
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
};

const { ensureWgAdmin } = await import('./admin-succession');

function reset() {
	state.selects = [];
	state.calls = [];
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

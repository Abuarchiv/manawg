import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import type { DbTransaction } from '@/core/db/transaction';

let settledIds = new Set<string>();

// The database layer connects on import; the logic under test only needs table markers.
mock.module('server-only', { namedExports: {} });
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		eq: (column: unknown, value: unknown) => [column, value],
		inArray: (column: unknown, values: unknown) => [column, values],
	},
});
mock.module('@/core/db', {
	namedExports: { auditEvents: {}, expenseImports: {}, expenses: {}, wgMembers: {} },
});
mock.module('@/core/audit-values', {
	namedExports: { auditValues: (values: Record<string, unknown>) => values },
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		withExpensePaymentLock: async (_wgId: string, fn: (tx: DbTransaction) => Promise<unknown>) =>
			fn(currentTx),
	},
});
mock.module('@/features/expenses/server/import-settled', {
	namedExports: { findSettledImportIds: async () => settledIds },
});
const { undoImport } = await import('@/features/expenses/server/import-undo');

const WG = '99999999-9999-4999-8999-999999999999';
const IMPORT = '55555555-5555-4555-8555-555555555555';
const IMPORTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const imp = { source: 'splitwise', importedBy: IMPORTER, startedAt: new Date('2026-09-01') };

let currentTx: DbTransaction;

/** A transaction whose selects answer from a queue, in the order undoImport asks. */
function fakeTx(datasets: unknown[][]) {
	const deleted: number[] = [];
	const inserted: Array<Record<string, unknown>> = [];
	let call = 0;
	const tx = {
		select: () => {
			const rows = datasets[call++] ?? [];
			const builder = Promise.resolve(rows) as unknown as Record<string, unknown>;
			for (const method of ['from', 'where', 'limit']) builder[method] = () => builder;
			return builder;
		},
		delete: () => ({
			where: async () => {
				deleted.push(call);
			},
		}),
		insert: () => ({
			values: async (values: Record<string, unknown>) => {
				inserted.push(values);
			},
		}),
	} as unknown as DbTransaction;
	return { tx, deleted, inserted };
}

async function run(caller: unknown[], actorId: string, importRows: unknown[] = [imp]) {
	settledIds = new Set();
	const fake = fakeTx([importRows, caller, [{ id: 'e1' }, { id: 'e2' }]]);
	currentTx = fake.tx;
	const result = await undoImport(WG, IMPORT, { memberId: actorId, name: 'Anna' });
	return { result, ...fake };
}

test('the member who imported removes the import and its expenses with an audit entry', async () => {
	const { result, deleted, inserted } = await run(
		[{ role: 'member', deactivatedAt: null }],
		IMPORTER,
	);
	assert.deepEqual(result, {
		ok: true,
		removed: 2,
		source: 'splitwise',
		importedByMemberId: IMPORTER,
	});
	assert.equal(deleted.length, 2);
	assert.equal(inserted[0]?.eventType, 'import.undone');
});

test('an admin may undo the import of another member', async () => {
	const { result } = await run([{ role: 'admin', deactivatedAt: null }], ADMIN);
	assert.equal(result.ok, true);
});

test('another member cannot undo the import and nothing is deleted', async () => {
	const { result, deleted, inserted } = await run([{ role: 'member', deactivatedAt: null }], OTHER);
	assert.deepEqual(result, { ok: false, error: 'not_allowed' });
	assert.equal(deleted.length, 0);
	assert.equal(inserted.length, 0);
});

test('a deactivated importer cannot undo the import', async () => {
	const { result, deleted } = await run(
		[{ role: 'member', deactivatedAt: new Date('2026-09-02') }],
		IMPORTER,
	);
	assert.deepEqual(result, { ok: false, error: 'not_allowed' });
	assert.equal(deleted.length, 0);
});

test('a caller who is no member of the WG cannot undo the import', async () => {
	const { result, deleted } = await run([], IMPORTER);
	assert.deepEqual(result, { ok: false, error: 'not_allowed' });
	assert.equal(deleted.length, 0);
});

test('an import with a settled share is refused and nothing is deleted', async () => {
	settledIds = new Set([IMPORT]);
	const fake = fakeTx([[imp], [{ role: 'member', deactivatedAt: null }]]);
	currentTx = fake.tx;
	const result = await undoImport(WG, IMPORT, { memberId: IMPORTER, name: 'Anna' });
	assert.deepEqual(result, { ok: false, error: 'import_settled' });
	assert.equal(fake.deleted.length, 0);
	assert.equal(fake.inserted.length, 0);
});

test('an unknown import id is reported as not found', async () => {
	const { result, deleted } = await run([{ role: 'admin', deactivatedAt: null }], ADMIN, []);
	assert.deepEqual(result, { ok: false, error: 'import_not_found' });
	assert.equal(deleted.length, 0);
});

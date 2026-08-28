import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
	delete: vi.fn(),
	insert: vi.fn(),
	select: vi.fn(),
	update: vi.fn(),
}));

const txMock = vi.hoisted(() => ({ committed: false, rolledBack: false }));

// The transaction is stubbed with the same `dbMock` behind it, so the existing
// call expectations keep working and the tests can additionally assert whether
// the run committed or rolled back.
vi.mock('@/core/db/transaction', () => ({
	withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
		try {
			const result = await fn({
				delete: (...args: unknown[]) => dbMock.delete(...args),
				insert: (...args: unknown[]) => dbMock.insert(...args),
				select: (...args: unknown[]) => dbMock.select(...args),
				update: (...args: unknown[]) => dbMock.update(...args),
			});
			txMock.committed = true;
			return result;
		} catch (err) {
			txMock.rolledBack = true;
			throw err;
		}
	},
}));

vi.mock('@/core/db', () => ({
	announcements: {},
	db: dbMock,
	expenseImports: { id: 'expenseImports.id' },
	expenseSplits: {},
	expenses: {
		id: 'expenses.id',
		wgId: 'expenses.wgId',
		occurredAt: 'expenses.occurredAt',
		description: 'expenses.description',
		amountCents: 'expenses.amountCents',
		paidByMemberId: 'expenses.paidByMemberId',
		importDuplicateKey: 'expenses.importDuplicateKey',
	},
	wgMembers: {
		id: 'wgMembers.id',
		wgId: 'wgMembers.wgId',
	},
}));

vi.mock('@/core/utils/money', () => ({
	formatEuroCents: (n: number) => `${(n / 100).toFixed(2)} €`,
}));

vi.mock('@/core/notifications/notification-dispatch', () => ({
	dispatchNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/audit', () => ({
	recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (...args: unknown[]) => ({ eq: args }),
	inArray: (...args: unknown[]) => ({ inArray: args }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

type ChainPromise<T> = Promise<T> & {
	from: (...args: unknown[]) => ChainPromise<T>;
	onConflictDoNothing: (...args: unknown[]) => ChainPromise<T>;
	returning: (...args: unknown[]) => ChainPromise<T>;
	set: (...args: unknown[]) => ChainPromise<T>;
	values: (...args: unknown[]) => ChainPromise<T>;
	where: (...args: unknown[]) => ChainPromise<T>;
};

function chainResult<T>(result: T): ChainPromise<T> {
	const promise = Promise.resolve(result) as ChainPromise<T>;
	const noop = () => promise;
	promise.from = noop;
	promise.onConflictDoNothing = noop;
	promise.returning = noop;
	promise.set = noop;
	promise.values = noop;
	promise.where = noop;
	return promise;
}

function chainFailure<T = never>(error: unknown): ChainPromise<T> {
	const promise = Promise.reject(error) as ChainPromise<T>;
	// The rejection is created when the mock is queued but only awaited once the
	// code under test reaches that statement — several microtasks later, since
	// the write now runs inside a transaction wrapper. Node reports that gap as
	// an unhandled rejection; this no-op catch marks it handled and leaves
	// `promise` itself rejected for the caller.
	promise.catch(() => undefined);
	const noop = () => promise;
	promise.from = noop;
	promise.onConflictDoNothing = noop;
	promise.returning = noop;
	promise.set = noop;
	promise.values = noop;
	promise.where = noop;
	return promise;
}

describe('commitImport', () => {
	beforeEach(() => {
		txMock.committed = false;
		txMock.rolledBack = false;
	});

	it('rolls the import row back when loading duplicate keys fails', async () => {
		vi.clearAllMocks();
		const duplicateLoadError = new Error('duplicate key load failed');
		dbMock.select
			.mockReturnValueOnce(chainResult([{ id: 'member-1' }]))
			.mockReturnValueOnce(chainFailure(duplicateLoadError));
		dbMock.insert.mockReturnValueOnce(chainResult([{ id: 'import-1' }]));
		dbMock.delete.mockReturnValue(chainResult([]));

		const { commitImport } = await import('./import-commit');
		await expect(
			commitImport({
				wg: { id: 'wg-1', name: 'Küche', shareCode: 'MTE8PZAT' },
				source: 'splitwise_csv',
				importedByMemberId: 'member-1',
				importedByName: 'Lisa',
				expenses: [
					{
						skip: false,
						parsed: {
							date: '2026-04-01',
							description: 'Pizza',
							amountCents: 2000,
							currency: 'EUR',
							paidByName: 'Lisa',
							splits: [{ memberName: 'Lisa', amountCents: 2000 }],
							warnings: [],
						},
					},
				],
				mapping: { Lisa: 'member-1' },
				skipDuplicates: true,
				rawPayloadHash: 'hash',
			}),
		).rejects.toThrow('duplicate key load failed');

		expect(dbMock.insert).toHaveBeenCalledOnce();
		// The import row disappears with the rollback. It used to be removed by a
		// separate delete, which is itself a database call and was additionally
		// swallowed with `.catch(() => undefined)`.
		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
		expect(dbMock.delete).not.toHaveBeenCalled();
	});

	/**
	 * An import writes one row per expense plus that expense's splits. When the
	 * run dies halfway through, the expenses already written must not survive:
	 * they skew every balance in the WG, while the user sees nothing but an
	 * error and imports the same file again. The old code repaired this with a
	 * delete afterwards — a database call that could fail itself, and whose
	 * failure was swallowed, so the half-written import stayed behind unnoticed.
	 */
	it('rolls the whole import back when the splits of an expense cannot be written', async () => {
		vi.clearAllMocks();
		const splitError = new Error('split insert failed');
		dbMock.select
			.mockReturnValueOnce(chainResult([{ id: 'member-1' }]))
			.mockReturnValueOnce(chainResult([]));
		dbMock.insert
			.mockReturnValueOnce(chainResult([{ id: 'import-1' }]))
			.mockReturnValueOnce(chainResult([{ id: 'expense-1' }]))
			.mockReturnValueOnce(chainFailure(splitError));
		dbMock.delete.mockReturnValue(chainResult([]));
		dbMock.update.mockReturnValue(chainResult([]));

		const { commitImport } = await import('./import-commit');
		await expect(
			commitImport({
				wg: { id: 'wg-1', name: 'Küche', shareCode: 'MTE8PZAT' },
				source: 'splitwise_csv',
				importedByMemberId: 'member-1',
				importedByName: 'Lisa',
				expenses: [
					{
						skip: false,
						parsed: {
							date: '2026-04-01',
							description: 'Pizza',
							amountCents: 2000,
							currency: 'EUR',
							paidByName: 'Lisa',
							splits: [{ memberName: 'Lisa', amountCents: 2000 }],
							warnings: [],
						},
					},
				],
				mapping: { Lisa: 'member-1' },
				skipDuplicates: true,
				rawPayloadHash: 'hash',
			}),
		).rejects.toThrow('split insert failed');

		expect(txMock.rolledBack).toBe(true);
		expect(txMock.committed).toBe(false);
		expect(dbMock.delete).not.toHaveBeenCalled();
	});

	it('does not insert the same parsed expense twice when two commits race', async () => {
		vi.clearAllMocks();
		dbMock.select
			.mockReturnValueOnce(chainResult([{ id: 'member-1' }]))
			.mockReturnValueOnce(chainResult([{ id: 'member-1' }]))
			.mockReturnValueOnce(chainResult([]))
			.mockReturnValueOnce(chainResult([]));
		dbMock.insert
			.mockReturnValueOnce(chainResult([{ id: 'import-1' }]))
			.mockReturnValueOnce(chainResult([{ id: 'import-2' }]))
			.mockReturnValueOnce(chainResult([{ id: 'expense-1' }]))
			.mockReturnValueOnce(chainResult([]))
			.mockReturnValue(chainResult([]));
		dbMock.update.mockReturnValue(chainResult([]));

		const makeInput = () => ({
			wg: { id: 'wg-1', name: 'Küche', shareCode: 'MTE8PZAT' },
			source: 'splitwise_csv' as const,
			importedByMemberId: 'member-1',
			importedByName: 'Lisa',
			expenses: [
				{
					skip: false,
					parsed: {
						date: '2026-04-01T00:00:00.000Z',
						description: 'Pizza',
						amountCents: 2000,
						currency: 'EUR' as const,
						paidByName: 'Lisa',
						splits: [{ memberName: 'Lisa', amountCents: 2000 }],
						warnings: [],
					},
				},
			],
			mapping: { Lisa: 'member-1' },
			skipDuplicates: true,
			rawPayloadHash: 'same-payload-hash',
		});

		const { commitImport } = await import('./import-commit');
		const [first, second] = await Promise.all([
			commitImport(makeInput()),
			commitImport(makeInput()),
		]);

		expect(first.inserted + second.inserted).toBe(1);
		expect(first.skipped + second.skipped).toBe(1);
	});
});

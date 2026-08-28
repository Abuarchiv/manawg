import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
}));

vi.mock('@/core/db', () => ({
	db: {
		select: (...args: unknown[]) => dbMock.select(...args),
	},
	wgInventoryLog: {
		itemId: 'wgInventoryLog.itemId',
		delta: 'wgInventoryLog.delta',
		kind: 'wgInventoryLog.kind',
		createdAt: 'wgInventoryLog.createdAt',
	},
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	eq: (...args: unknown[]) => ({ eq: args }),
	gte: (...args: unknown[]) => ({ gte: args }),
	lt: (...args: unknown[]) => ({ lt: args }),
	inArray: (...args: unknown[]) => ({ inArray: args }),
}));

const ITEM_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

interface LogRow {
	itemId: string;
	delta: number;
}

function setupSelect(rows: LogRow[]): void {
	dbMock.select.mockImplementation(() => ({
		from: vi.fn(() => ({
			where: vi.fn().mockResolvedValue(rows),
		})),
	}));
}

describe('getRecentDecrementCount', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the number of consume rows for the item', async () => {
		setupSelect([
			{ itemId: ITEM_A, delta: -1 },
			{ itemId: ITEM_A, delta: -2 },
			{ itemId: ITEM_A, delta: -1 },
		]);
		const { getRecentDecrementCount } = await import('./inventory-decrements');
		const count = await getRecentDecrementCount(ITEM_A);
		expect(count).toBe(3);
	});

	it('returns zero when there are no consume rows', async () => {
		setupSelect([]);
		const { getRecentDecrementCount } = await import('./inventory-decrements');
		const count = await getRecentDecrementCount(ITEM_A);
		expect(count).toBe(0);
	});
});

describe('getRecentDecrementCounts (batch)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a zero-initialized map for empty input without hitting the db', async () => {
		const { getRecentDecrementCounts } = await import('./inventory-decrements');
		const result = await getRecentDecrementCounts([]);
		expect(result.size).toBe(0);
		expect(dbMock.select).not.toHaveBeenCalled();
	});

	it('aggregates counts per itemId', async () => {
		setupSelect([
			{ itemId: ITEM_A, delta: -1 },
			{ itemId: ITEM_A, delta: -3 },
			{ itemId: ITEM_B, delta: -1 },
		]);
		const { getRecentDecrementCounts } = await import('./inventory-decrements');
		const result = await getRecentDecrementCounts([ITEM_A, ITEM_B]);
		expect(result.get(ITEM_A)).toBe(2);
		expect(result.get(ITEM_B)).toBe(1);
	});

	it('returns zero for items with no log rows', async () => {
		setupSelect([{ itemId: ITEM_A, delta: -1 }]);
		const { getRecentDecrementCounts } = await import('./inventory-decrements');
		const result = await getRecentDecrementCounts([ITEM_A, ITEM_B]);
		expect(result.get(ITEM_A)).toBe(1);
		expect(result.get(ITEM_B)).toBe(0);
	});
});

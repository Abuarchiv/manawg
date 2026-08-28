import { describe, expect, it } from 'vitest';
import {
	INVENTORY_LIMITS,
	buildShoppingPushPayload,
	clampQuantity,
	groupItemsByCategory,
	isBelowThreshold,
	isValidCategory,
	normalizeForMatch,
	shouldAutoPushToShopping,
} from './inventory';

const NEAR_LIMIT = INVENTORY_LIMITS.QUANTITY_MAX;
const OVER_LIMIT = NEAR_LIMIT + 1;

describe('isBelowThreshold', () => {
	it('returns true when quantity equals threshold', () => {
		expect(isBelowThreshold({ quantity: 2, threshold: 2 })).toBe(true);
	});

	it('returns true when quantity is below threshold', () => {
		expect(isBelowThreshold({ quantity: 1, threshold: 2 })).toBe(true);
	});

	it('returns false when quantity exceeds threshold', () => {
		expect(isBelowThreshold({ quantity: 3, threshold: 2 })).toBe(false);
	});

	it('treats a zero threshold as triggering only at zero quantity', () => {
		expect(isBelowThreshold({ quantity: 0, threshold: 0 })).toBe(true);
		expect(isBelowThreshold({ quantity: 1, threshold: 0 })).toBe(false);
	});
});

describe('shouldAutoPushToShopping', () => {
	const item = { name: 'Klopapier', quantity: 1, threshold: 2 };

	it('returns false when item is above threshold', () => {
		expect(shouldAutoPushToShopping({ ...item, quantity: 5 }, [])).toBe(false);
	});

	it('returns true when below threshold and shopping list has no matching open entry', () => {
		expect(shouldAutoPushToShopping(item, [{ name: 'Milch', boughtAt: null }])).toBe(true);
	});

	it('returns false when a matching open shopping item already exists (case-insensitive)', () => {
		expect(shouldAutoPushToShopping(item, [{ name: '  klopapier  ', boughtAt: null }])).toBe(false);
	});

	it('ignores already-bought shopping items', () => {
		expect(
			shouldAutoPushToShopping(item, [{ name: 'Klopapier', boughtAt: new Date('2026-05-01') }]),
		).toBe(true);
	});
});

describe('buildShoppingPushPayload', () => {
	it('formats the missing quantity plus one with the unit', () => {
		const payload = buildShoppingPushPayload({
			name: 'Klopapier',
			quantity: 1,
			threshold: 4,
			unit: 'Rolle',
		});
		expect(payload).toEqual({
			name: 'Klopapier',
			quantity: '4 Rolle',
			note: 'Auto: Vorrat unter Schwelle',
		});
	});

	it('returns at least one missing unit even when quantity exceeds threshold', () => {
		const payload = buildShoppingPushPayload({
			name: 'Spülmittel',
			quantity: 5,
			threshold: 1,
			unit: 'Stück',
		});
		expect(payload.quantity).toBe('1 Stück');
	});
});

describe('clampQuantity', () => {
	it('clamps negative numbers to zero', () => {
		expect(clampQuantity(-3)).toBe(0);
	});

	it('clamps values above the maximum to the maximum', () => {
		expect(clampQuantity(OVER_LIMIT)).toBe(NEAR_LIMIT);
	});

	it('rounds non-integers down', () => {
		expect(clampQuantity(3.9)).toBe(3);
	});

	it('returns zero for non-finite values', () => {
		expect(clampQuantity(Number.NaN)).toBe(0);
		expect(clampQuantity(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('isValidCategory', () => {
	it('accepts known categories', () => {
		expect(isValidCategory('bad')).toBe(true);
		expect(isValidCategory('kueche')).toBe(true);
		expect(isValidCategory('putzmittel')).toBe(true);
		expect(isValidCategory('sonstiges')).toBe(true);
	});

	it('rejects unknown categories', () => {
		expect(isValidCategory('garten')).toBe(false);
		expect(isValidCategory('')).toBe(false);
	});
});

describe('normalizeForMatch', () => {
	it('lowercases and trims whitespace', () => {
		expect(normalizeForMatch('  Klopapier  ')).toBe('klopapier');
	});
});

describe('groupItemsByCategory', () => {
	it('returns empty arrays for all known categories when input is empty', () => {
		expect(groupItemsByCategory([])).toEqual({
			bad: [],
			kueche: [],
			putzmittel: [],
			sonstiges: [],
		});
	});

	it('routes unknown category strings to sonstiges', () => {
		const items = [
			{ id: 'a', category: 'kueche' },
			{ id: 'b', category: 'mystery' },
		];
		const grouped = groupItemsByCategory(items);
		expect(grouped.kueche).toHaveLength(1);
		expect(grouped.sonstiges).toHaveLength(1);
	});
});

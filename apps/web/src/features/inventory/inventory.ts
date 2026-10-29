import { intlTag } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';

export const INVENTORY_LIST_LIMIT = 1000;

export const INVENTORY_CATEGORIES = ['bathroom', 'kitchen', 'cleaning', 'other'] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/** Stored unit keys; each is also the argument of the `inventory.unit` message. */
export const INVENTORY_UNITS = ['piece', 'litre', 'kilogram', 'roll', 'pack'] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

export const INVENTORY_LIMITS = {
	NAME_MIN: 1,
	NAME_MAX: 120,
	QUANTITY_MIN: 0,
	QUANTITY_MAX: 9999,
	THRESHOLD_MIN: 0,
	THRESHOLD_MAX: 9999,
	UNIT_MAX: 40,
	CATEGORY_MAX: 40,
	CONSUME_DELTA_MIN: -100,
	// A consume takes at least one unit; zero would only re-trigger the
	// low-stock push and shopping entry without anything being used.
	CONSUME_DELTA_MAX: -1,
} as const;

/**
 * An inventory item as the API returns it.
 *
 * Shared by the page and its components; kept outside the page so components
 * do not import from it.
 */
export interface InventoryItemDto {
	id: string;
	wgId: string;
	name: string;
	quantity: number;
	unit: string;
	threshold: number;
	category: string;
	lastDecrementedAt: string | null;
	decrementCount30d: number;
	createdAt: string;
	updatedAt: string;
}

export type InventoryMutationItemDto = Omit<InventoryItemDto, 'decrementCount30d'> & {
	decrementCount30d?: number;
};

interface InventoryItemForThresholdCheck {
	quantity: number;
	threshold: number;
}

export function isBelowThreshold(item: InventoryItemForThresholdCheck): boolean {
	return item.quantity <= item.threshold;
}

export function normalizeForMatch(name: string): string {
	return name.trim().toLowerCase();
}

/** Units that bring a scarce item back above its threshold (same amount the shopping push asks for). */
export function restockAmount(item: InventoryItemForThresholdCheck): number {
	return clampQuantity(isBelowThreshold(item) ? item.threshold - item.quantity + 1 : 1);
}

/** Scarce items whose name matches something just bought: the stock was not raised by the purchase. */
export function boughtRestockMatches<T extends InventoryItemForThresholdCheck & { name: string }>(
	items: T[],
	boughtNames: string[],
): T[] {
	const bought = new Set(boughtNames.map(normalizeForMatch));
	return items.filter((item) => isBelowThreshold(item) && bought.has(normalizeForMatch(item.name)));
}

const QUICK_RESTOCK_MIN_ROWS = 5;
const QUICK_RESTOCK_MAX_LOW = 10;

/** Scarce items first (largest shortfall), then the most consumed of the last 30 days up to a minimum row count. */
export function quickRestockCandidates<
	T extends InventoryItemForThresholdCheck & { name: string; decrementCount30d: number },
>(items: T[], locale: Locale = 'de'): T[] {
	const low = items
		.filter(isBelowThreshold)
		.sort(
			(a, b) =>
				b.threshold - b.quantity - (a.threshold - a.quantity) ||
				a.name.localeCompare(b.name, intlTag(locale)),
		)
		.slice(0, QUICK_RESTOCK_MAX_LOW);
	const frequent = items
		.filter((item) => !isBelowThreshold(item) && item.decrementCount30d > 0)
		.sort((a, b) => b.decrementCount30d - a.decrementCount30d)
		.slice(0, Math.max(0, QUICK_RESTOCK_MIN_ROWS - low.length));
	return [...low, ...frequent];
}

export function clampQuantity(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < INVENTORY_LIMITS.QUANTITY_MIN) return INVENTORY_LIMITS.QUANTITY_MIN;
	if (value > INVENTORY_LIMITS.QUANTITY_MAX) return INVENTORY_LIMITS.QUANTITY_MAX;
	return roundQuantity(value);
}

/** Two decimals match the numeric(10,2) columns and absorb float noise such as 2.3 - 1. */
export function roundQuantity(value: number): number {
	return Math.round(value * 100) / 100;
}

function isValidCategory(value: string): value is InventoryCategory {
	return (INVENTORY_CATEGORIES as readonly string[]).includes(value);
}

export function groupItemsByCategory<T extends { category: string }>(
	items: T[],
): Record<InventoryCategory, T[]> {
	const groups: Record<InventoryCategory, T[]> = {
		bathroom: [],
		kitchen: [],
		cleaning: [],
		other: [],
	};
	for (const item of items) {
		const category = isValidCategory(item.category) ? item.category : 'other';
		groups[category].push(item);
	}
	return groups;
}

/** The decimal separator the quantity fields show: a comma in German, a point in English. */
const decimalSeparator = (locale: Locale): string => (locale === 'en' ? '.' : ',');

/** Typed quantity text with the locale's separator: "." and "," both count, digits only, at most two decimals. */
export function decimalQuantityText(raw: string, locale: Locale = 'de'): string {
	const [whole = '', ...fraction] = raw.replace(/\./g, ',').split(',');
	const digits = whole.replace(/\D/g, '');
	if (fraction.length === 0) return digits;
	return `${digits}${decimalSeparator(locale)}${fraction.join('').replace(/\D/g, '').slice(0, 2)}`;
}

/** An empty field counts as 0; the value is clamped only on save so the field can stay empty while typing. */
export function parseQuantityText(text: string): number {
	return clampQuantity(Number(text.replace(',', '.') || 0));
}

/** Input field text for a stored quantity: 1.5 is "1,5" in German and "1.5" in English. */
export function quantityInputText(quantity: number, locale: Locale = 'de'): string {
	return String(quantity).replace('.', decimalSeparator(locale));
}

import { MS_PER_DAY } from '@/core/utils/time';
import {
	type InventoryItemDto,
	isBelowThreshold,
	normalizeForMatch,
} from '@/features/inventory/inventory';
import { QUICK_SHOPPING_ITEMS } from '@/features/shopping/components/constants';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';

/** Items bought within this window are not suggested again. */
const RECENTLY_BOUGHT_MS = MS_PER_DAY;
const MAX_SUGGESTIONS_PER_GROUP = 4;

export interface SuggestionGroup {
	label: string;
	names: string[];
}

/**
 * Chips offered above the list: nearly empty pantry items, then the most consumed ones, or a
 * few staples while the list is empty. Nothing already open or just bought is offered, and a
 * name appears in at most one group.
 */
export function buildSuggestionGroups({
	items,
	inventory,
	now,
}: {
	items: ShoppingItem[];
	inventory: InventoryItemDto[];
	now: number;
}): SuggestionGroup[] {
	const taken = new Set<string>();
	for (const item of items) {
		const recent = item.boughtAt !== null && Date.parse(item.boughtAt) > now - RECENTLY_BOUGHT_MS;
		if (item.boughtAt === null || recent) taken.add(normalizeForMatch(item.name));
	}
	const lowStock = inventory
		.filter((item) => isBelowThreshold(item) && !taken.has(normalizeForMatch(item.name)))
		.map((item) => item.name);
	for (const name of lowStock) taken.add(normalizeForMatch(name));
	const frequent: string[] = [];
	const byConsumption = inventory
		.filter((item) => item.decrementCount30d > 0)
		.sort((a, b) => b.decrementCount30d - a.decrementCount30d);
	for (const { name } of byConsumption) {
		const key = normalizeForMatch(name);
		if (taken.has(key)) continue;
		taken.add(key);
		frequent.push(name);
	}
	const second: SuggestionGroup =
		frequent.length > 0
			? { label: 'Oft gekauft', names: frequent.slice(0, MAX_SUGGESTIONS_PER_GROUP) }
			: {
					label: 'Vorschläge',
					names:
						items.length === 0
							? QUICK_SHOPPING_ITEMS.filter((name) => !taken.has(normalizeForMatch(name)))
							: [],
				};
	return [
		{ label: 'Bald leer', names: lowStock.slice(0, MAX_SUGGESTIONS_PER_GROUP) },
		second,
	].filter((group) => group.names.length > 0);
}

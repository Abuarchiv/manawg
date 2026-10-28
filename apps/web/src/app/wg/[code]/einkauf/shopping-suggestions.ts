import { MS_PER_DAY } from '@/core/utils/time';
import {
	type InventoryItemDto,
	isBelowThreshold,
	normalizeForMatch,
} from '@/features/inventory/inventory';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import type { Message } from '@/shared/i18n/message';

/** Items bought within this window are not suggested again. */
const RECENTLY_BOUGHT_MS = MS_PER_DAY;
const MAX_SUGGESTIONS_PER_GROUP = 4;

export interface SuggestionGroup {
	label: Message;
	names: string[];
}

/**
 * Chips offered above the list: nearly empty pantry items, then the most consumed ones, or a
 * few `staples` while the list is empty. Nothing already open or just bought is offered, and a
 * name appears in at most one group.
 */
export function buildSuggestionGroups({
	items,
	inventory,
	staples,
	now,
}: {
	items: ShoppingItem[];
	inventory: InventoryItemDto[];
	staples: readonly string[];
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
			? {
					label: { key: 'shopping.suggestions.frequent' },
					names: frequent.slice(0, MAX_SUGGESTIONS_PER_GROUP),
				}
			: {
					label: { key: 'shopping.suggestions.staples' },
					names:
						items.length === 0 ? staples.filter((name) => !taken.has(normalizeForMatch(name))) : [],
				};
	const first: SuggestionGroup = {
		label: { key: 'shopping.suggestions.lowStock' },
		names: lowStock.slice(0, MAX_SUGGESTIONS_PER_GROUP),
	};
	return [first, second].filter((group) => group.names.length > 0);
}

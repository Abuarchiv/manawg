import type { ShoppingItem } from '@/features/shopping/components/shopping-types';

// Keeps the same array reference when nothing actually changed, so memoized
// rows do not re-render on unrelated state updates (typing, error banners).
export function keepItems(prev: ShoppingItem[], next: ShoppingItem[]): ShoppingItem[] {
	const unchanged =
		prev.length === next.length && prev.every((item, index) => item === next[index]);
	return unchanged ? prev : next;
}

const byCreated = (a: ShoppingItem, b: ShoppingItem) =>
	a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function splitShoppingItems(items: ShoppingItem[]): {
	open: ShoppingItem[];
	done: ShoppingItem[];
	openItems: ShoppingItem[];
	doneItems: ShoppingItem[];
} {
	const open = items.filter((i) => i.boughtAt === null);
	const done = items.filter((i) => i.boughtAt !== null);
	return {
		open,
		done,
		openItems: [...open].sort(byCreated),
		doneItems: [...done].sort(
			(a, b) => (b.boughtAt ?? '').localeCompare(a.boughtAt ?? '') || byCreated(a, b),
		),
	};
}

/** Link into the expense form with the given fields prefilled (`desc`, `paidBy`, ...). */
export function expensePrefillHref(shareCode: string, prefill: Record<string, string>): string {
	return `/wg/${encodeURIComponent(shareCode)}/ausgaben?${new URLSearchParams(prefill)}`;
}

/** Placeholder ID of an item that is just being sent to the server. */
export const TEMP_ITEM_ID_PREFIX = 'tmp-';
export const isTempItemId = (id: string): boolean => id.startsWith(TEMP_ITEM_ID_PREFIX);

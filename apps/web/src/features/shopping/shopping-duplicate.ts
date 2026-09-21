const SHOPPING_ITEMS_UNIQUE_OPEN_NAME = 'shopping_items_unique_open_name';

export function isOpenShoppingItemDuplicate(err: unknown): boolean {
	const seen = new Set<object>();
	let current: unknown = err;
	while (current && typeof current === 'object' && !seen.has(current)) {
		seen.add(current);
		if (
			'code' in current &&
			(current as { code?: unknown }).code === '23505' &&
			(current as { constraint?: unknown }).constraint === SHOPPING_ITEMS_UNIQUE_OPEN_NAME
		) {
			return true;
		}
		current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
	}
	return false;
}

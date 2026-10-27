import { isUniqueViolation } from '@/core/db/pg-errors';

const SHOPPING_ITEMS_UNIQUE_OPEN_NAME = 'shopping_items_unique_open_name';

export function isOpenShoppingItemDuplicate(err: unknown): boolean {
	return isUniqueViolation(err, SHOPPING_ITEMS_UNIQUE_OPEN_NAME);
}

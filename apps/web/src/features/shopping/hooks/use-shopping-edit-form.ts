import { useState } from 'react';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import type { Message } from '@/shared/i18n/message';
import type { ShoppingEditResult } from './use-shopping-edit';

export type ShoppingEditFields = { name: string; quantity: string | null };

/** Field state of the item edit form, seeded once from the item the form was opened on. */
export function useShoppingEditForm(
	item: ShoppingItem,
	onSave: (base: ShoppingItem, fields: ShoppingEditFields) => Promise<ShoppingEditResult>,
	onDone: () => void,
) {
	// A poll can replace `item` while the form is open; the save is checked against the version
	// the user edited, so a housemate's change in between is refused instead of overwritten.
	const [base] = useState(item);
	const [name, setName] = useState(item.name);
	const [quantity, setQuantity] = useState(item.quantity ?? '');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<Message | null>(null);

	async function submit(): Promise<void> {
		setSaving(true);
		setError(null);
		const message = await onSave(base, { name, quantity: quantity.trim() || null });
		setSaving(false);
		if (message === null) onDone();
		else setError(message);
	}

	return { name, setName, quantity, setQuantity, saving, error, submit };
}

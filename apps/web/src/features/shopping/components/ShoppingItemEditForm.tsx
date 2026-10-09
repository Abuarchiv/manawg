'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { NAME_MAX, QUANTITY_MAX } from '@/features/shopping/components/constants';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { useState } from 'react';

interface ShoppingItemEditFormProps {
	item: ShoppingItem;
	/** null = saved, otherwise the message to show in the form. */
	onSave: (item: ShoppingItem, name: string, quantity: string | null) => Promise<string | null>;
	onDone: () => void;
}

/** Name and amount of an open item, shown inside the item's action drawer. */
export function ShoppingItemEditForm({
	item: latestItem,
	onSave,
	onDone,
}: ShoppingItemEditFormProps) {
	// The row as the form opened: a background refresh must not hand a newer version to the save.
	const [item] = useState(latestItem);
	const [name, setName] = useState(item.name);
	const [quantity, setQuantity] = useState(item.quantity ?? '');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const trimmedName = name.trim();
	const trimmedQuantity = quantity.trim();
	const unchanged = trimmedName === item.name && trimmedQuantity === (item.quantity ?? '');

	async function save(): Promise<void> {
		if (saving || trimmedName.length === 0 || unchanged) return;
		setSaving(true);
		setError(null);
		const failure = await onSave(item, trimmedName, trimmedQuantity || null);
		setSaving(false);
		if (failure) setError(failure);
		else onDone();
	}

	return (
		<form
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
			className="flex flex-col gap-3"
		>
			<FieldGroup>
				<Field data-invalid={Boolean(error)}>
					<FieldLabel htmlFor={`shopping-edit-name-${item.id}`}>Artikel</FieldLabel>
					<Input
						id={`shopping-edit-name-${item.id}`}
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						maxLength={NAME_MAX}
						disabled={saving}
						required
						aria-invalid={Boolean(error) || undefined}
						aria-describedby={error ? `shopping-edit-error-${item.id}` : undefined}
						className="text-base"
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={`shopping-edit-quantity-${item.id}`}>Menge (optional)</FieldLabel>
					<Input
						id={`shopping-edit-quantity-${item.id}`}
						value={quantity}
						onChange={(event) => {
							setQuantity(event.target.value);
							setError(null);
						}}
						maxLength={QUANTITY_MAX}
						disabled={saving}
						placeholder="z. B. 2 Packungen"
						className="text-base"
					/>
				</Field>
			</FieldGroup>
			{error && (
				<Alert variant="destructive">
					<AlertDescription id={`shopping-edit-error-${item.id}`}>{error}</AlertDescription>
				</Alert>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					disabled={saving || trimmedName.length === 0 || unchanged}
					className="min-h-11 flex-1"
				>
					{saving && <Spinner data-icon="inline-start" aria-hidden />}
					Speichern
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={saving}
					onClick={onDone}
					className="min-h-11 flex-1"
				>
					Abbrechen
				</Button>
			</div>
		</form>
	);
}

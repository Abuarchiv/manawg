'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from '@/components/ui/drawer';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch } from '@/core/infra/api-client';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_CATEGORY_LABELS,
	INVENTORY_LIMITS,
	INVENTORY_UNITS,
	type InventoryCategory,
	type InventoryUnit,
} from '@/features/inventory/inventory';
import { useEffect, useState } from 'react';

interface InventoryAddModalProps {
	open: boolean;
	shareCode: string;
	memberId: string;
	memberToken?: string | undefined;
	mode: 'create' | 'edit';
	initial?: {
		id: string;
		name: string;
		quantity: number;
		unit: string;
		threshold: number;
		category: string;
	} | null;
	onClose: () => void;
	onSaved: () => void;
}

const DEFAULT_UNIT: InventoryUnit = 'Stück';
const DEFAULT_CATEGORY: InventoryCategory = 'sonstiges';

function coerceUnit(unit: string | undefined): InventoryUnit {
	if (unit && (INVENTORY_UNITS as readonly string[]).includes(unit)) {
		return unit as InventoryUnit;
	}
	return DEFAULT_UNIT;
}

function coerceCategory(category: string | undefined): InventoryCategory {
	if (category && (INVENTORY_CATEGORIES as readonly string[]).includes(category)) {
		return category as InventoryCategory;
	}
	return DEFAULT_CATEGORY;
}

export function InventoryAddModal({
	open,
	shareCode,
	memberId,
	memberToken,
	mode,
	initial,
	onClose,
	onSaved,
}: InventoryAddModalProps) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const [name, setName] = useState('');
	const [quantity, setQuantity] = useState(0);
	const [unit, setUnit] = useState<InventoryUnit>(DEFAULT_UNIT);
	const [threshold, setThreshold] = useState(1);
	const [category, setCategory] = useState<InventoryCategory>(DEFAULT_CATEGORY);
	const [saving, setSaving] = useState(false);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setName(initial?.name ?? '');
		setQuantity(initial?.quantity ?? 0);
		setUnit(coerceUnit(initial?.unit));
		setThreshold(initial?.threshold ?? 1);
		setCategory(coerceCategory(initial?.category));
		setError(null);
	}, [open, initial]);

	function requestClose(): void {
		if (saving) return;
		const dirty =
			name !== (initial?.name ?? '') ||
			quantity !== (initial?.quantity ?? 0) ||
			unit !== coerceUnit(initial?.unit) ||
			threshold !== (initial?.threshold ?? 1) ||
			category !== coerceCategory(initial?.category);
		if (dirty) setDiscardOpen(true);
		else onClose();
	}

	async function save(): Promise<void> {
		if (saving) return;
		const trimmedName = name.trim();
		if (trimmedName.length === 0) {
			setError('Bitte gib einen Namen ein.');
			return;
		}
		setSaving(true);
		setError(null);
		const body = {
			name: trimmedName,
			quantity,
			unit,
			threshold,
			category,
		};
		const res =
			mode === 'edit' && initial
				? await apiFetch(
						`/api/wg/${encodedShareCode}/inventory/${encodeURIComponent(initial.id)}`,
						{ method: 'PATCH', memberId, memberToken, body: JSON.stringify(body) },
					)
				: await apiFetch(`/api/wg/${encodedShareCode}/inventory`, {
						method: 'POST',
						memberId,
						memberToken,
						body: JSON.stringify(body),
					});
		setSaving(false);
		if (res.ok) {
			onSaved();
			onClose();
		} else {
			setError('Speichern fehlgeschlagen.');
		}
	}

	return (
		<Drawer
			open={open}
			onOpenChange={(next) => {
				if (!next) requestClose();
			}}
		>
			<DrawerContent className="mx-auto w-full max-w-md">
				<DrawerHeader>
					<DrawerTitle>{mode === 'edit' ? 'Vorrat bearbeiten' : 'Neuer Vorrat'}</DrawerTitle>
					<DrawerDescription>
						{mode === 'edit'
							? 'Menge, Schwelle, Einheit und Kategorie anpassen.'
							: 'Name, Menge, Schwelle, Einheit und Kategorie festlegen.'}
					</DrawerDescription>
				</DrawerHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4"
					style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
				>
					<FieldGroup>
						<Field data-invalid={Boolean(error)}>
							<FieldLabel htmlFor="inventory-name">Name</FieldLabel>
							<Input
								id="inventory-name"
								type="text"
								value={name}
								onChange={(event) => setName(event.target.value)}
								maxLength={INVENTORY_LIMITS.NAME_MAX}
								required
								aria-required="true"
								aria-invalid={Boolean(error)}
								aria-describedby={error ? 'inventory-add-error' : undefined}
								placeholder="z. B. Nudeln"
								disabled={saving}
								className="min-h-11 text-base"
							/>
						</Field>
						<div className="grid grid-cols-2 gap-2">
							<Field className="min-w-0">
								<FieldLabel htmlFor="inventory-qty">Menge</FieldLabel>
								<Input
									id="inventory-qty"
									type="number"
									inputMode="numeric"
									value={quantity}
									min={INVENTORY_LIMITS.QUANTITY_MIN}
									max={INVENTORY_LIMITS.QUANTITY_MAX}
									onChange={(event) => setQuantity(Number(event.target.value) || 0)}
									disabled={saving}
									className="min-h-11 text-base"
								/>
							</Field>
							<Field className="min-w-0">
								<FieldLabel htmlFor="inventory-threshold">Schwelle</FieldLabel>
								<Input
									id="inventory-threshold"
									type="number"
									inputMode="numeric"
									value={threshold}
									min={INVENTORY_LIMITS.THRESHOLD_MIN}
									max={INVENTORY_LIMITS.THRESHOLD_MAX}
									onChange={(event) => setThreshold(Number(event.target.value) || 0)}
									disabled={saving}
									className="min-h-11 text-base"
								/>
							</Field>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Field className="min-w-0">
								<FieldLabel htmlFor="inventory-unit">Einheit</FieldLabel>
								<NativeSelect
									id="inventory-unit"
									value={unit}
									onChange={(event) => setUnit(event.target.value as InventoryUnit)}
									disabled={saving}
									className="w-full [&_select]:min-h-11 [&_select]:text-base"
								>
									{INVENTORY_UNITS.map((u) => (
										<NativeSelectOption key={u} value={u}>
											{u}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field className="min-w-0">
								<FieldLabel htmlFor="inventory-category">Kategorie</FieldLabel>
								<NativeSelect
									id="inventory-category"
									value={category}
									onChange={(event) => setCategory(event.target.value as InventoryCategory)}
									disabled={saving}
									className="w-full [&_select]:min-h-11 [&_select]:text-base"
								>
									{INVENTORY_CATEGORIES.map((cat) => (
										<NativeSelectOption key={cat} value={cat}>
											{INVENTORY_CATEGORY_LABELS[cat]}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
						</div>
						<FieldDescription>
							Beim Verbrauchen bis zur Schwelle wird fehlender Vorrat auf die Einkaufsliste gesetzt.
						</FieldDescription>
					</FieldGroup>
					{error && (
						<FieldError>
							<Alert variant="destructive">
								<AlertDescription>
									<span id="inventory-add-error">{error}</span>
								</AlertDescription>
							</Alert>
						</FieldError>
					)}
					<DrawerFooter className="flex-row justify-end gap-2 p-0">
						<Button type="button" variant="outline" onClick={requestClose} className="min-h-11">
							Abbrechen
						</Button>
						<Button type="submit" disabled={saving} className="min-h-11">
							{saving && <Spinner aria-hidden />}
							{saving ? 'Speichert…' : 'Speichern'}
						</Button>
					</DrawerFooter>
				</form>
				<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
					<AlertDialogContent className="w-[calc(100%-2rem)]">
						<AlertDialogHeader>
							<AlertDialogTitle>Änderungen verwerfen?</AlertDialogTitle>
							<AlertDialogDescription>
								Deine Eingaben wurden noch nicht gespeichert.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel className="min-h-11">Weiter bearbeiten</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								className="min-h-11"
								onClick={() => {
									setDiscardOpen(false);
									onClose();
								}}
							>
								Verwerfen
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</DrawerContent>
		</Drawer>
	);
}

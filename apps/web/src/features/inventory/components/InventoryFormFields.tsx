import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_CATEGORY_LABELS,
	INVENTORY_LIMITS,
	INVENTORY_UNITS,
	type InventoryCategory,
	type InventoryUnit,
	isBelowThreshold,
} from '@/features/inventory/inventory';

interface InventoryFormFieldsProps {
	mode: 'create' | 'edit';
	name: string;
	quantityText: string;
	thresholdText: string;
	unit: InventoryUnit;
	category: InventoryCategory;
	quantity: number;
	threshold: number;
	nameError: string | null;
	disabled: boolean;
	onNameChange: (value: string) => void;
	onQuantityTextChange: (value: string) => void;
	onThresholdTextChange: (value: string) => void;
	onUnitChange: (value: InventoryUnit) => void;
	onCategoryChange: (value: InventoryCategory) => void;
}

export function InventoryFormFields({
	mode,
	name,
	quantityText,
	thresholdText,
	unit,
	category,
	quantity,
	threshold,
	nameError,
	disabled,
	onNameChange,
	onQuantityTextChange,
	onThresholdTextChange,
	onUnitChange,
	onCategoryChange,
}: InventoryFormFieldsProps) {
	return (
		<FieldGroup>
			<Field data-invalid={Boolean(nameError)}>
				<FieldLabel htmlFor="inventory-name">Name</FieldLabel>
				<Input
					id="inventory-name"
					type="text"
					value={name}
					onChange={(event) => {
						onNameChange(event.target.value);
					}}
					maxLength={INVENTORY_LIMITS.NAME_MAX}
					required
					aria-required="true"
					aria-invalid={Boolean(nameError)}
					aria-describedby={nameError ? 'inventory-name-error' : undefined}
					placeholder="z. B. Nudeln"
					disabled={disabled}
					enterKeyHint="next"
					className="text-base"
				/>
				{nameError && <FieldError id="inventory-name-error">{nameError}</FieldError>}
			</Field>
			<div className="grid grid-cols-1 gap-2">
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-qty">Menge</FieldLabel>
					<Input
						id="inventory-qty"
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={String(INVENTORY_LIMITS.QUANTITY_MAX).length}
						value={quantityText}
						onChange={(event) => onQuantityTextChange(event.target.value.replace(/\D/g, ''))}
						onFocus={(event) => event.currentTarget.select()}
						disabled={disabled}
						className="text-base"
					/>
				</Field>
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-threshold">Nachkaufen ab</FieldLabel>
					<Input
						id="inventory-threshold"
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={String(INVENTORY_LIMITS.THRESHOLD_MAX).length}
						value={thresholdText}
						onChange={(event) => onThresholdTextChange(event.target.value.replace(/\D/g, ''))}
						onFocus={(event) => event.currentTarget.select()}
						disabled={disabled}
						className="text-base"
					/>
				</Field>
			</div>
			<div className="grid grid-cols-1 gap-2">
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-unit">Einheit</FieldLabel>
					<NativeSelect
						id="inventory-unit"
						value={unit}
						onChange={(event) => onUnitChange(event.target.value as InventoryUnit)}
						disabled={disabled}
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
						onChange={(event) => onCategoryChange(event.target.value as InventoryCategory)}
						disabled={disabled}
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
			<FieldDescription aria-live="polite">
				{mode === 'create' && isBelowThreshold({ quantity, threshold })
					? 'Kommt beim Speichern direkt auf die Einkaufsliste.'
					: 'Ab diesem Bestand kommt der Vorrat auf die Einkaufsliste.'}
			</FieldDescription>
		</FieldGroup>
	);
}

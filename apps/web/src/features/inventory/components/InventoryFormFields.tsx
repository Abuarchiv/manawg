import { useLocale, useTranslations } from 'next-intl';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
	decimalQuantityText,
	INVENTORY_CATEGORIES,
	INVENTORY_LIMITS,
	INVENTORY_UNITS,
	type InventoryCategory,
	type InventoryUnit,
	isBelowThreshold,
	unitLabelKey,
} from '@/features/inventory/inventory';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, useMessage } from '@/shared/i18n/message';

interface InventoryFormFieldsProps {
	mode: 'create' | 'edit';
	name: string;
	quantityText: string;
	thresholdText: string;
	unit: InventoryUnit;
	category: InventoryCategory;
	quantity: number;
	threshold: number;
	nameError: Message | null;
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
	const t = useTranslations('inventory');
	const render = useMessage();
	const locale = useLocale() as Locale;
	return (
		<FieldGroup>
			<Field data-invalid={Boolean(nameError)}>
				<FieldLabel htmlFor="inventory-name">{t('form.name')}</FieldLabel>
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
					placeholder={t('form.namePlaceholder')}
					disabled={disabled}
					enterKeyHint="next"
					className="text-base"
				/>
				{nameError && <FieldError id="inventory-name-error">{render(nameError)}</FieldError>}
			</Field>
			<div className="grid grid-cols-1 gap-2">
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-qty">{t('form.quantity')}</FieldLabel>
					<Input
						id="inventory-qty"
						type="text"
						inputMode="decimal"
						maxLength={String(INVENTORY_LIMITS.QUANTITY_MAX).length + 3}
						value={quantityText}
						onChange={(event) =>
							onQuantityTextChange(decimalQuantityText(event.target.value, locale))
						}
						onFocus={(event) => event.currentTarget.select()}
						disabled={disabled}
						className="text-base"
					/>
				</Field>
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-threshold">{t('form.threshold')}</FieldLabel>
					<Input
						id="inventory-threshold"
						type="text"
						inputMode="decimal"
						maxLength={String(INVENTORY_LIMITS.THRESHOLD_MAX).length + 3}
						value={thresholdText}
						onChange={(event) =>
							onThresholdTextChange(decimalQuantityText(event.target.value, locale))
						}
						onFocus={(event) => event.currentTarget.select()}
						disabled={disabled}
						className="text-base"
					/>
				</Field>
			</div>
			<div className="grid grid-cols-1 gap-2">
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-unit">{t('form.unit')}</FieldLabel>
					<NativeSelect
						id="inventory-unit"
						value={unit}
						onChange={(event) => onUnitChange(event.target.value as InventoryUnit)}
						disabled={disabled}
						className="w-full [&_select]:min-h-11 [&_select]:text-base"
					>
						{INVENTORY_UNITS.map((u) => (
							<NativeSelectOption key={u} value={u}>
								{t('unit', { unit: unitLabelKey(u), count: 1 })}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				<Field className="min-w-0">
					<FieldLabel htmlFor="inventory-category">{t('form.category')}</FieldLabel>
					<NativeSelect
						id="inventory-category"
						value={category}
						onChange={(event) => onCategoryChange(event.target.value as InventoryCategory)}
						disabled={disabled}
						className="w-full [&_select]:min-h-11 [&_select]:text-base"
					>
						{INVENTORY_CATEGORIES.map((cat) => (
							<NativeSelectOption key={cat} value={cat}>
								{t(`categories.${cat}`)}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			</div>
			<FieldDescription aria-live="polite">
				{mode === 'create' && isBelowThreshold({ quantity, threshold })
					? t('form.hintCreateLow')
					: t('form.hint')}
			</FieldDescription>
		</FieldGroup>
	);
}

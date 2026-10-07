'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { ImageUploader } from '@/components/wg/ImageUploader';
import { ChevronDown, Receipt, Repeat2 } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { RECURRING_INTERVAL_OPTIONS } from './constants';
import type { RecurringExpense } from './expense-types';

interface ExpenseExtrasProps {
	shareCode: string;
	imageUrl: string | null;
	setImageUrl: Dispatch<SetStateAction<string | null>>;
	recurringIntervalMonths: number;
	setRecurringIntervalMonths: Dispatch<SetStateAction<number>>;
	editingRecurringExpense: RecurringExpense | null;
	isEditingQueuedExpense: boolean;
	isEditingQueuedRecurring: boolean;
	savingRecurringTemplate: boolean;
	onSaveRecurringTemplate: () => void;
	formSaving: boolean;
}

/** Optional parts of an expense: the receipt image and the recurring template. */
export function ExpenseExtras({
	shareCode,
	imageUrl,
	setImageUrl,
	recurringIntervalMonths,
	setRecurringIntervalMonths,
	editingRecurringExpense,
	isEditingQueuedExpense,
	isEditingQueuedRecurring,
	savingRecurringTemplate,
	onSaveRecurringTemplate,
	formSaving,
}: ExpenseExtrasProps) {
	const [showRecurring, setShowRecurring] = useState(false);
	const [showReceipt, setShowReceipt] = useState(Boolean(imageUrl));
	const recurringOpen =
		showRecurring || editingRecurringExpense !== null || isEditingQueuedRecurring;
	return (
		<>
			<Collapsible open={showReceipt} onOpenChange={setShowReceipt}>
				<CollapsibleTrigger
					render={<Button type="button" variant="ghost" className="w-full justify-start" />}
					disabled={formSaving}
				>
					<Receipt data-icon="inline-start" />
					<span className="min-w-0 flex-1 text-left">Beleg hinzufügen</span>
					{imageUrl && (
						<Badge variant="secondary" className="shrink-0">
							Angehängt
						</Badge>
					)}
					<ChevronDown data-icon="inline-end" className="shrink-0" />
				</CollapsibleTrigger>
				<CollapsiblePanel>
					<div className="pt-3">
						<ImageUploader
							shareCode={shareCode}
							purpose="expense"
							value={imageUrl}
							onChange={setImageUrl}
							disabled={formSaving}
							imageLabel="Beleg"
						/>
					</div>
				</CollapsiblePanel>
			</Collapsible>
			<Collapsible open={recurringOpen} onOpenChange={setShowRecurring}>
				<CollapsibleTrigger
					render={<Button type="button" variant="ghost" className="w-full justify-start" />}
					disabled={formSaving || editingRecurringExpense !== null || isEditingQueuedRecurring}
				>
					<Repeat2 data-icon="inline-start" />
					<span className="min-w-0 flex-1 text-left">Fixkosten-Vorlage</span>
					{recurringOpen && (
						<Badge variant="secondary" className="shrink-0">
							{recurringIntervalMonths === 1
								? 'Monatlich'
								: `Alle ${recurringIntervalMonths} Monate`}
						</Badge>
					)}
					<ChevronDown data-icon="inline-end" className="shrink-0" />
				</CollapsibleTrigger>
				<CollapsiblePanel>
					<FieldGroup className="pt-3">
						<Field>
							<FieldLabel htmlFor="expense-interval">Wiederholung</FieldLabel>
							<NativeSelect
								id="expense-interval"
								value={recurringIntervalMonths}
								onChange={(event) => setRecurringIntervalMonths(Number(event.target.value))}
								disabled={formSaving}
								className="w-full [&_select]:h-11 [&_select]:text-base"
							>
								{RECURRING_INTERVAL_OPTIONS.map(({ value, label }) => (
									<NativeSelectOption key={value} value={value}>
										{label}
									</NativeSelectOption>
								))}
							</NativeSelect>
							<FieldDescription>
								Die Vorlage merkt Betrag, zahlende Person und diese Aufteilung.
							</FieldDescription>
						</Field>
						{!isEditingQueuedExpense && !isEditingQueuedRecurring && !editingRecurringExpense && (
							<Button
								type="button"
								variant="outline"
								onClick={onSaveRecurringTemplate}
								disabled={formSaving}
							>
								{savingRecurringTemplate && <Spinner data-icon="inline-start" />}Als Vorlage merken
							</Button>
						)}
					</FieldGroup>
				</CollapsiblePanel>
			</Collapsible>
		</>
	);
}

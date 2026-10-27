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
import { cn } from '@/shared/lib/cn';
import { Check, ChevronDown, Receipt, Repeat2 } from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
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
	/** Number of known templates: if it grows while saving, the save succeeded. */
	recurringTemplateCount: number;
	formSaving: boolean;
	onImageUploadingChange: (uploading: boolean) => void;
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
	recurringTemplateCount,
	formSaving,
	onImageUploadingChange,
}: ExpenseExtrasProps) {
	const [showRecurring, setShowRecurring] = useState(false);
	const [showReceipt, setShowReceipt] = useState(Boolean(imageUrl));
	const [templateSaved, setTemplateSaved] = useState(false);
	const templateCountAtStart = useRef(recurringTemplateCount);
	const wasSavingTemplate = useRef(false);
	// The form scrolls and a toast would sit beneath the fullscreen sheet, so a line right at the button confirms instead.
	useEffect(() => {
		if (savingRecurringTemplate) {
			if (!wasSavingTemplate.current) templateCountAtStart.current = recurringTemplateCount;
			wasSavingTemplate.current = true;
			setTemplateSaved(false);
			return;
		}
		if (!wasSavingTemplate.current) return;
		wasSavingTemplate.current = false;
		if (recurringTemplateCount > templateCountAtStart.current) setTemplateSaved(true);
	}, [savingRecurringTemplate, recurringTemplateCount]);
	useEffect(() => {
		if (!templateSaved) return;
		const timer = window.setTimeout(() => setTemplateSaved(false), 6000);
		return () => window.clearTimeout(timer);
	}, [templateSaved]);
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
					<ChevronDown
						data-icon="inline-end"
						className="shrink-0 transition-transform group-aria-expanded/button:rotate-180"
					/>
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
							onUploadingChange={onImageUploadingChange}
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
					<ChevronDown
						data-icon="inline-end"
						className="shrink-0 transition-transform group-aria-expanded/button:rotate-180"
					/>
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
								className="w-full [&_select]:h-auto [&_select]:py-[0.5625rem] [&_select]:text-base"
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
						<output
							className={cn(
								'flex items-center gap-1.5 text-sm text-foreground',
								!templateSaved && 'sr-only',
							)}
						>
							{templateSaved && (
								<>
									<Check className="size-4 shrink-0" aria-hidden />
									Als Vorlage gespeichert. Sie steht unter Fixkosten.
								</>
							)}
						</output>
					</FieldGroup>
				</CollapsiblePanel>
			</Collapsible>
		</>
	);
}

'use client';

import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from '@/components/ui/field';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Member } from '@/components/wg/WgContextProvider';
import { formatEuroCents } from '@/core/utils/money';
import { remainderCandidates } from '@/features/expenses/expense-split-input';
import type { Dispatch, SetStateAction } from 'react';
import { ManualSplitSummary } from './ManualSplitSummary';
import { SplitReview } from './SplitReview';
import type { SplitMode } from './expense-form-draft';

interface ExpenseSplitFieldsetProps {
	members: Member[];
	splitCandidates: Member[];
	splitMode: SplitMode;
	setSplitMode: Dispatch<SetStateAction<SplitMode>>;
	manualSplits: Record<string, string>;
	setManualSplits: Dispatch<SetStateAction<Record<string, string>>>;
	splitsError: string | undefined;
	onClearSplitsError: () => void;
	amountStr: string;
	currency: string;
	paidByMemberId: string;
	previewSplits: Array<{ debtorMemberId: string; amountCents: number }> | null;
	isEditingExpense: boolean;
	formSaving: boolean;
}

/**
 * "Beteiligte & Aufteilung": equal split preview or one share field per member. When an
 * existing expense has a moved-out member's share, that share stays locked.
 */
export function ExpenseSplitFieldset({
	members,
	splitCandidates,
	splitMode,
	setSplitMode,
	manualSplits,
	setManualSplits,
	splitsError,
	onClearSplitsError,
	amountStr,
	currency,
	paidByMemberId,
	previewSplits,
	isEditingExpense,
	formSaving,
}: ExpenseSplitFieldsetProps) {
	const splitErrorId = 'expense-splits-error';
	const hasLockedHistoricalShare =
		isEditingExpense && splitCandidates.some((member) => !member.active);
	const historicalShareHintId = `${splitErrorId}-inactive-share`;
	const remainderMembers = remainderCandidates(members);
	const firstSplitMemberId = splitCandidates[0]?.id;
	const splitErrorTargetsMode =
		Boolean(splitsError) && (splitMode !== 'manual' || firstSplitMemberId === undefined);
	return (
		<FieldSet disabled={formSaving} data-invalid={Boolean(splitsError)}>
			<FieldLegend variant="label">Beteiligte & Aufteilung</FieldLegend>
			<ToggleGroup
				variant="segmented"
				value={[splitMode]}
				onValueChange={(values) => {
					onClearSplitsError();
					const value = values[0];
					if (value === 'equal' || value === 'manual') setSplitMode(value);
				}}
				className="w-full"
				aria-label="Aufteilung"
				aria-invalid={splitErrorTargetsMode ? true : undefined}
				aria-describedby={splitErrorTargetsMode ? splitErrorId : undefined}
			>
				<ToggleGroupItem
					value="equal"
					className="flex-1"
					disabled={hasLockedHistoricalShare}
					aria-label="Aufteilung: Gleichmäßig"
					aria-describedby={hasLockedHistoricalShare ? historicalShareHintId : undefined}
				>
					Gleichmäßig
				</ToggleGroupItem>
				<ToggleGroupItem value="manual" className="flex-1" aria-label="Aufteilung: Manuell">
					Manuell
				</ToggleGroupItem>
			</ToggleGroup>
			{hasLockedHistoricalShare && (
				<FieldDescription id={historicalShareHintId}>
					Ausgezogene Anteile bleiben unverändert; nur aktive Personen übernehmen den Rest.
				</FieldDescription>
			)}
			{splitsError && <FieldError id={splitErrorId}>{splitsError}</FieldError>}
			{splitMode === 'manual' && (
				<FieldGroup className={splitsError ? 'block space-y-3' : 'gap-3'}>
					{splitCandidates.map((member, index) => (
						<Field
							key={member.id}
							orientation="responsive"
							data-disabled={formSaving || (isEditingExpense && !member.active)}
							data-invalid={Boolean(splitsError) && member.id === firstSplitMemberId}
						>
							<FieldLabel htmlFor={`share-${member.id}`} className="min-w-0 flex-1 break-words">
								{member.name}
								{isEditingExpense && !member.active && (
									<span className="ml-1 text-xs font-normal text-muted-foreground">
										(ausgezogen)
									</span>
								)}
							</FieldLabel>
							<InputGroup className="w-full min-w-32 shrink-0 @md/field-group:max-w-32">
								<InputGroupInput
									id={`share-${member.id}`}
									type="text"
									inputMode="decimal"
									value={manualSplits[member.id] ?? ''}
									onChange={(event) => {
										setManualSplits((previous) => ({
											...previous,
											[member.id]: event.target.value,
										}));
										onClearSplitsError();
									}}
									placeholder="0,00"
									disabled={formSaving || (isEditingExpense && !member.active)}
									enterKeyHint={index === splitCandidates.length - 1 ? 'done' : 'next'}
									aria-label={`Anteil ${member.name} in ${currency === 'EUR' ? 'Euro' : currency}${isEditingExpense && !member.active ? ', ausgezogen. Anteil bleibt unverändert.' : ''}`}
									aria-invalid={
										Boolean(splitsError) && member.id === firstSplitMemberId ? true : undefined
									}
									aria-describedby={
										Boolean(splitsError) && member.id === firstSplitMemberId
											? splitErrorId
											: undefined
									}
									className="min-h-11 font-mono tabular-nums text-base"
								/>
								<InputGroupAddon align="inline-end">
									<InputGroupText>{currency === 'EUR' ? '€' : currency}</InputGroupText>
								</InputGroupAddon>
							</InputGroup>
						</Field>
					))}
					<ManualSplitSummary
						amountStr={amountStr}
						currency={currency}
						manualSplits={manualSplits}
						members={remainderMembers}
						setManualSplits={setManualSplits}
						disabled={formSaving}
					/>
					{!splitsError && (
						<FieldDescription>
							Leer lassen oder{' '}
							<span className="font-mono tabular-nums">{formatEuroCents(0, currency)}</span> für
							keinen Anteil.
						</FieldDescription>
					)}
				</FieldGroup>
			)}
			{splitMode !== 'manual' && (
				<SplitReview
					members={splitCandidates}
					splits={previewSplits}
					paidByMemberId={paidByMemberId}
					currency={currency}
				/>
			)}
		</FieldSet>
	);
}

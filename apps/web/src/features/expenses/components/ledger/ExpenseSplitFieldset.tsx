'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { formatEuroCents } from '@/core/utils/money';
import type { SplitMode } from '@/features/expenses/expense-form-draft';
import {
	type ChangedSettledShare,
	isUnreadableShare,
	remainderCandidates,
} from '@/features/expenses/expense-split-input';
import type { ExpenseSplitShare } from '@/features/expenses/expense-types';
import { EqualParticipantsPicker } from './EqualParticipantsPicker';
import { ManualSplitSummary } from './ManualSplitSummary';
import { monoAmount } from './mono-amount';
import { SplitReview } from './SplitReview';

interface ExpenseSplitFieldsetProps {
	members: Member[];
	splitCandidates: Member[];
	splitMode: SplitMode;
	setSplitMode: Dispatch<SetStateAction<SplitMode>>;
	manualSplits: Record<string, string>;
	setManualSplits: Dispatch<SetStateAction<Record<string, string>>>;
	/** Who shares an equal split; null means every active member. */
	participantIds: string[] | null;
	setParticipantIds: (ids: string[] | null) => void;
	/** Paid shares the current edit would reopen. */
	changedSettledShares: ChangedSettledShare[];
	splitsError: string | undefined;
	onClearSplitsError: () => void;
	amountStr: string;
	currency: string;
	paidByMemberId: string;
	previewSplits: ExpenseSplitShare[] | null;
	isEditingExpense: boolean;
	formSaving: boolean;
}

/**
 * Participants and split: equal split preview or one share field per member. When an
 * existing expense has a moved-out member's share, that share stays locked.
 */
export function ExpenseSplitFieldset({
	members,
	splitCandidates,
	splitMode,
	setSplitMode,
	manualSplits,
	setManualSplits,
	participantIds,
	setParticipantIds,
	changedSettledShares,
	splitsError,
	onClearSplitsError,
	amountStr,
	currency,
	paidByMemberId,
	previewSplits,
	isEditingExpense,
	formSaving,
}: ExpenseSplitFieldsetProps) {
	const locale = useLocale();
	const t = useTranslations('expenses-form.split');
	const tForm = useTranslations('expenses-form.fields');
	const tCommon = useTranslations('common');
	const splitErrorId = 'expense-splits-error';
	const hasLockedHistoricalShare =
		isEditingExpense && splitCandidates.some((member) => !member.active);
	const historicalShareHintId = `${splitErrorId}-inactive-share`;
	const remainderMembers = remainderCandidates(members);
	const firstSplitMemberId = splitCandidates[0]?.id;
	const memberName = (id: string) =>
		members.find((member) => member.id === id)?.name ?? tCommon('unknownPerson');
	// An unreadable share is the field to fix; a wrong sum or empty split anchors on the first row.
	const unreadableIds = splitCandidates
		.filter((member) => isUnreadableShare(manualSplits[member.id], locale))
		.map((member) => member.id);
	const marksShare = (id: string) =>
		Boolean(splitsError) &&
		(unreadableIds.length > 0 ? unreadableIds.includes(id) : id === firstSplitMemberId);
	const splitErrorTargetsMode =
		Boolean(splitsError) && (splitMode !== 'manual' || firstSplitMemberId === undefined);
	return (
		<FieldSet disabled={formSaving} data-invalid={Boolean(splitsError)}>
			<FieldLegend variant="label">{t('legend')}</FieldLegend>
			<ToggleGroup
				variant="segmented"
				value={[splitMode]}
				onValueChange={(values) => {
					onClearSplitsError();
					const value = values[0];
					if (value === 'equal' || value === 'manual') setSplitMode(value);
				}}
				className="w-full"
				aria-label={t('toggleAria')}
				aria-invalid={splitErrorTargetsMode ? true : undefined}
				aria-describedby={splitErrorTargetsMode ? splitErrorId : undefined}
			>
				<ToggleGroupItem
					value="equal"
					className="flex-1"
					disabled={hasLockedHistoricalShare}
					aria-label={t('equalAria')}
					aria-describedby={hasLockedHistoricalShare ? historicalShareHintId : undefined}
				>
					{t('equal')}
				</ToggleGroupItem>
				<ToggleGroupItem value="manual" className="flex-1" aria-label={t('manualAria')}>
					{t('manual')}
				</ToggleGroupItem>
			</ToggleGroup>
			{hasLockedHistoricalShare && (
				<FieldDescription id={historicalShareHintId}>{t('lockedHint')}</FieldDescription>
			)}
			{splitsError && <FieldError id={splitErrorId}>{splitsError}</FieldError>}
			{splitMode === 'manual' && (
				<FieldGroup className={splitsError ? 'block space-y-3' : 'gap-3'}>
					{splitCandidates.map((member, index) => (
						<Field
							key={member.id}
							orientation="responsive"
							data-disabled={formSaving || (isEditingExpense && !member.active)}
						>
							<FieldLabel htmlFor={`share-${member.id}`} className="min-w-0 flex-1 break-words">
								{member.name}
								{isEditingExpense && !member.active && (
									<span className="ml-1 text-xs font-normal text-muted-foreground">
										{t('movedOut')}
									</span>
								)}
							</FieldLabel>
							<InputGroup className="w-full min-w-32 shrink-0 has-[[data-slot][aria-invalid=true]]:border-input has-[[data-slot][aria-invalid=true]]:ring-0 @md/field-group:max-w-32">
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
									onBlur={(event) => {
										const euros = parseEuroAmount(event.target.value, locale);
										if (euros === null || euros < 0) return;
										const formatted = formatEuroInput(euros, locale);
										setManualSplits((previous) => ({ ...previous, [member.id]: formatted }));
									}}
									placeholder={tForm('amountPlaceholder')}
									disabled={formSaving || (isEditingExpense && !member.active)}
									enterKeyHint={index === splitCandidates.length - 1 ? 'done' : 'next'}
									aria-label={t(
										isEditingExpense && !member.active ? 'shareAriaMovedOut' : 'shareAria',
										{ name: member.name, currency },
									)}
									aria-invalid={marksShare(member.id) ? true : undefined}
									aria-describedby={marksShare(member.id) ? splitErrorId : undefined}
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
							{t.rich('zeroHint', {
								zero: monoAmount(formatEuroCents(0, currency, { locale })),
							})}
						</FieldDescription>
					)}
				</FieldGroup>
			)}
			{splitMode !== 'manual' && (
				<EqualParticipantsPicker
					candidates={splitCandidates}
					participantIds={participantIds}
					onChange={(ids) => {
						onClearSplitsError();
						setParticipantIds(ids);
					}}
					idPrefix="participant"
					disabled={formSaving}
				/>
			)}
			{splitMode !== 'manual' && (
				<SplitReview
					members={splitCandidates}
					splits={previewSplits}
					paidByMemberId={paidByMemberId}
					currency={currency}
				/>
			)}
			{changedSettledShares.length > 0 && (
				<Alert variant="destructive">
					<AlertDescription className="flex flex-col gap-1">
						{changedSettledShares.map((share) => (
							<span key={share.debtorMemberId}>
								{t('settledShareLocked', {
									name: memberName(share.debtorMemberId),
									previous: formatEuroCents(share.previousCents, currency, { locale }),
									removed: share.nextCents === null ? 'yes' : 'other',
									next:
										share.nextCents === null
											? ''
											: formatEuroCents(share.nextCents, currency, { locale }),
								})}
							</span>
						))}
					</AlertDescription>
				</Alert>
			)}
		</FieldSet>
	);
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
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
import { eurosToCents, parseEuroAmount } from '@/core/utils/amount';
import { formatEuroCents } from '@/core/utils/money';
import type { AboSplitBuildError, SplitMode } from '@/features/expenses/abo-form-model';
import { EqualParticipantsPicker } from '@/features/expenses/components/ausgaben/EqualParticipantsPicker';
import { SplitReview } from '@/features/expenses/components/ausgaben/SplitReview';
import type { AboSplit, MemberOption } from '@/features/expenses/expense-types';
import type { Locale } from '@/shared/i18n/locale';

interface AboSplitFieldsProps {
	submitting: boolean;
	splitMode: SplitMode;
	/** Total amount in cents for the live sum; null while the amount is invalid. */
	totalCents: number | null;
	onSplitModeChange: (mode: SplitMode) => void;
	splitCandidates: MemberOption[];
	/** Who shares an equal split; null means every active member. */
	participantIds: string[] | null;
	onParticipantsChange: (ids: string[] | null) => void;
	manualSplits: Record<string, string>;
	onManualSplitChange: (memberId: string, value: string) => void;
	splitError: string | null;
	splitPreview: AboSplit[] | AboSplitBuildError;
	paidByMemberId: string;
}

/** Only an unreadable share is a problem in itself; a wrong sum concerns no single field. */
function isUnreadableShare(raw: string | undefined, locale: Locale): boolean {
	const value = raw?.trim() ?? '';
	if (value.length === 0) return false;
	const parsed = parseEuroAmount(value, locale);
	return parsed === null || parsed < 0;
}

/** Cents the manual shares add up to; unreadable and non-positive shares count as zero. */
function sumManualShares(manualSplits: Record<string, string>, locale: Locale): number {
	let sumCents = 0;
	for (const raw of Object.values(manualSplits)) {
		const parsed = parseEuroAmount(raw, locale);
		if (parsed !== null && parsed > 0) sumCents += eurosToCents(parsed);
	}
	return sumCents;
}

/** "Beteiligte & Aufteilung": equal split preview or one amount field per member. */
export function AboSplitFields({
	submitting,
	splitMode,
	totalCents,
	onSplitModeChange,
	splitCandidates,
	participantIds,
	onParticipantsChange,
	manualSplits,
	onManualSplitChange,
	splitError,
	splitPreview,
	paidByMemberId,
}: AboSplitFieldsProps) {
	const t = useTranslations('expenses-abos');
	const locale = useLocale();
	let sumHint = '';
	if (splitMode === 'manual') {
		if (totalCents === null) sumHint = t('split.sumHintNoTotal');
		else {
			const sumCents = sumManualShares(manualSplits, locale);
			sumHint = t('split.sumHint', {
				sum: formatEuroCents(sumCents, 'EUR', { locale }),
				total: formatEuroCents(totalCents, 'EUR', { locale }),
				state: sumCents === totalCents ? 'match' : sumCents < totalCents ? 'short' : 'over',
				amount: formatEuroCents(Math.abs(totalCents - sumCents), 'EUR', { locale }),
			});
		}
	}
	return (
		<FieldSet
			disabled={submitting}
			data-invalid={Boolean(splitError)}
			aria-describedby={splitError ? 'abo-splits-error' : undefined}
		>
			<FieldLegend variant="label">{t('split.legend')}</FieldLegend>
			<ToggleGroup
				variant="segmented"
				value={[splitMode]}
				onValueChange={(values) => {
					const value = values[0];
					if (value === 'equal' || value === 'manual') onSplitModeChange(value);
				}}
				className="w-full"
				aria-label={t('split.modeLabel')}
			>
				<ToggleGroupItem value="equal" className="flex-1">
					{t('split.equal')}
				</ToggleGroupItem>
				<ToggleGroupItem value="manual" className="flex-1">
					{t('split.manual')}
				</ToggleGroupItem>
			</ToggleGroup>
			{splitMode === 'manual' && <FieldDescription>{sumHint}</FieldDescription>}
			{splitMode === 'manual' && (
				<FieldGroup className={splitError ? 'block space-y-3' : 'gap-3'}>
					{splitCandidates.map((member, index) => (
						<Field key={member.id} orientation="responsive">
							<FieldLabel htmlFor={`abo-share-${member.id}`} className="min-w-0 flex-1 break-words">
								{member.name}
							</FieldLabel>
							<InputGroup className="w-full min-w-32 shrink-0 @md/field-group:max-w-32">
								<InputGroupInput
									id={`abo-share-${member.id}`}
									type="text"
									inputMode="decimal"
									value={manualSplits[member.id] ?? ''}
									onChange={(event) => onManualSplitChange(member.id, event.target.value)}
									placeholder={t('split.sharePlaceholder')}
									enterKeyHint={index === splitCandidates.length - 1 ? 'done' : 'next'}
									aria-label={t('split.shareLabel', { name: member.name })}
									disabled={submitting}
									aria-invalid={
										Boolean(splitError) && isUnreadableShare(manualSplits[member.id], locale)
									}
									aria-describedby={
										splitError && isUnreadableShare(manualSplits[member.id], locale)
											? 'abo-splits-error'
											: undefined
									}
									className="min-h-11 font-mono tabular-nums text-base"
								/>
								<InputGroupAddon align="inline-end">
									<InputGroupText>€</InputGroupText>
								</InputGroupAddon>
							</InputGroup>
						</Field>
					))}
				</FieldGroup>
			)}
			{splitError && (
				<FieldError id="abo-splits-error" className="scroll-mb-32">
					{splitError}
				</FieldError>
			)}
			{splitMode !== 'manual' && (
				<EqualParticipantsPicker
					candidates={splitCandidates}
					participantIds={participantIds}
					onChange={onParticipantsChange}
					idPrefix="abo-participant"
					disabled={submitting}
				/>
			)}
			{splitMode !== 'manual' &&
				(typeof splitPreview === 'string' ? (
					<FieldDescription>{t('split.equalHint')}</FieldDescription>
				) : (
					<SplitReview
						members={splitCandidates}
						splits={splitPreview}
						paidByMemberId={paidByMemberId}
					/>
				))}
		</FieldSet>
	);
}

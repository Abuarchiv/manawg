'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { useTodayInputValue } from '@/core/hooks/use-today-input-value';
import { eurosToCents, formatCentsInput, parseEuroAmount } from '@/core/utils/amount';
import { inputDateOrToday, inputDateToIso, isoToInputDate } from '@/core/utils/local-date';
import { ExpenseCategoryField } from '@/features/expenses/components/ledger/ExpenseCategoryField';
import {
	DEFAULT_EXPENSE_CATEGORY,
	type ExpenseCategory,
} from '@/features/expenses/expense-categories';
import {
	AMOUNT_MAX_EUROS,
	AMOUNT_MIN_EUROS,
	DESCRIPTION_MAX_LENGTH,
	RECURRING_INTERVAL_OPTIONS,
} from '@/features/expenses/expense-constants';
import type { MemberOption } from '@/features/expenses/expense-types';
import { countMissedOccurrences } from '@/features/expenses/recurring-expenses';
import {
	aboAmountError,
	aboSplitError,
	buildRecurringSplits,
	initialEqualParticipants,
	initialManualMap,
	type RecurringFormValues,
	type SplitMode,
} from '@/features/expenses/recurring-form-model';
import { type Message, useMessage } from '@/shared/i18n/message';
import { RecurringSplitFields } from './RecurringSplitFields';

const INTERVAL_OPTION_KEYS = {
	1: 'form.intervalOption.m1',
	2: 'form.intervalOption.m2',
	3: 'form.intervalOption.m3',
	6: 'form.intervalOption.m6',
	12: 'form.intervalOption.m12',
} as const satisfies Record<(typeof RECURRING_INTERVAL_OPTIONS)[number]['value'], string>;

const DESCRIPTION_ERROR: Message = { key: 'expenses-recurring.form.error.description' };
const DUE_MISSING_ERROR: Message = { key: 'expenses-recurring.form.error.dueMissing' };

interface RecurringFormProps {
	mode: 'create' | 'edit';
	members: MemberOption[];
	initial?: RecurringFormValues;
	defaultPaidByMemberId: string;
	submitting: boolean;
	saveError?: string | null | undefined;
	onCancel: () => void;
	onSubmit: (values: RecurringFormValues) => void;
}

export function RecurringForm({
	mode,
	members,
	initial,
	defaultPaidByMemberId,
	submitting,
	saveError,
	onCancel,
	onSubmit,
}: RecurringFormProps) {
	const t = useTranslations('expenses-recurring');
	const message = useMessage();
	const locale = useLocale();
	// Only active members are offered for new selections ("aus Listen raus").
	// Moved-out members are re-added below where an existing recurringExpense still references
	// them, so editing never silently drops or reassigns a participant.
	const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);

	const [description, setDescription] = useState(initial?.description ?? '');
	const [category, setCategory] = useState<ExpenseCategory>(
		initial?.category ?? DEFAULT_EXPENSE_CATEGORY,
	);
	const [amountStr, setAmountStr] = useState(
		initial ? formatCentsInput(initial.amountCents, locale) : '',
	);
	const [paidByMemberId, setPaidByMemberId] = useState(
		initial?.paidByMemberId ?? defaultPaidByMemberId,
	);
	const [intervalMonths, setIntervalMonths] = useState(initial?.intervalMonths ?? 1);
	// null until the resident picks a day, so a new subscription follows the current day.
	const [pickedNextDueAt, setNextDueAt] = useState<string | null>(
		initial ? isoToInputDate(initial.nextDueAt) : null,
	);
	const today = useTodayInputValue();
	const nextDueAt = pickedNextDueAt ?? today;
	const initialParticipants = initialEqualParticipants(initial, activeMembers);
	const [splitMode, setSplitMode] = useState<SplitMode>(
		initialParticipants === 'manual' ? 'manual' : 'equal',
	);
	const [participantIds, setParticipantIds] = useState<string[] | null>(
		initialParticipants === 'manual' ? null : initialParticipants,
	);
	const [manualSplits, setManualSplits] = useState<Record<string, string>>(
		initialManualMap(initial, locale),
	);
	const [error, setError] = useState<Message | null>(null);
	const [splitError, setSplitError] = useState<Message | null>(null);

	useEffect(() => {
		if (!initial) return;
		setDescription(initial.description);
		setCategory(initial.category);
		setAmountStr(formatCentsInput(initial.amountCents, locale));
		setPaidByMemberId(initial.paidByMemberId);
		setIntervalMonths(initial.intervalMonths);
		setNextDueAt(isoToInputDate(initial.nextDueAt));
		const participants = initialEqualParticipants(initial, activeMembers);
		setSplitMode(participants === 'manual' ? 'manual' : 'equal');
		setParticipantIds(participants === 'manual' ? null : participants);
		setManualSplits(initialManualMap(initial, locale));
		setSplitError(null);
	}, [initial, activeMembers, locale]);

	const parsedAmountCents = useMemo(() => {
		const euros = parseEuroAmount(amountStr, locale);
		if (euros === null || euros < AMOUNT_MIN_EUROS || euros > AMOUNT_MAX_EUROS) return null;
		return eurosToCents(euros);
	}, [amountStr, locale]);
	const descriptionError =
		error && (description.trim().length === 0 || description.trim().length > DESCRIPTION_MAX_LENGTH)
			? message(DESCRIPTION_ERROR)
			: null;
	const amountError =
		error && parsedAmountCents === null
			? message(aboAmountError(parseEuroAmount(amountStr, locale), amountStr))
			: null;
	// A start in the past is booked retroactively by the daily run; say so before it happens.
	const dueDateChanged = !initial || nextDueAt !== isoToInputDate(initial.nextDueAt);
	const missedBookings =
		dueDateChanged && nextDueAt.length > 0 && nextDueAt < today
			? countMissedOccurrences(inputDateToIso(nextDueAt) ?? '', intervalMonths)
			: 0;
	const nextDueError = error && nextDueAt.trim().length === 0 ? message(DUE_MISSING_ERROR) : null;
	const formError =
		error && !descriptionError && !amountError && !nextDueError ? message(error) : null;

	// Payer dropdown offers active members, but keeps the currently selected
	// payer visible even if they moved out — otherwise saving would silently
	// reassign the recurringExpense to someone else.
	const payerOptions = useMemo(() => {
		if (activeMembers.some((member) => member.id === paidByMemberId)) return activeMembers;
		return [...activeMembers, ...members.filter((member) => member.id === paidByMemberId)];
	}, [activeMembers, members, paidByMemberId]);

	// Manual split rows show active members plus any moved-out member who still
	// carries a share, so an edit preserves the stored amounts (sum stays exact).
	const splitCandidates = useMemo(() => {
		if (splitMode !== 'manual') return activeMembers;
		return members.filter(
			(member) => member.active || (manualSplits[member.id] ?? '').trim().length > 0,
		);
	}, [activeMembers, members, splitMode, manualSplits]);
	function buildSplits() {
		return buildRecurringSplits({
			amountCents: parsedAmountCents,
			splitMode,
			activeMembers,
			splitCandidates,
			manualSplits,
			participantIds,
			locale,
		});
	}

	function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		setError(null);
		setSplitError(null);
		const dueOn = inputDateOrToday(pickedNextDueAt);
		const trimmedDescription = description.trim();
		if (trimmedDescription.length === 0 || trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
			setError(DESCRIPTION_ERROR);
			return;
		}
		if (parsedAmountCents === null) {
			setError(aboAmountError(parseEuroAmount(amountStr, locale), amountStr));
			return;
		}
		if (dueOn.trim().length === 0) {
			setError(DUE_MISSING_ERROR);
			return;
		}
		// An unchanged date keeps the stored timestamp: otherwise every edit would move it to
		// 12:00 local time, and the server would reject a long-overdue date as out of range.
		const nextDueAtIso =
			initial && dueOn === isoToInputDate(initial.nextDueAt)
				? initial.nextDueAt
				: inputDateToIso(dueOn);
		if (nextDueAtIso === null) {
			setError(DUE_MISSING_ERROR);
			return;
		}
		const splits = buildSplits();
		if (typeof splits === 'string') {
			if (splits === 'amount_invalid') setError(aboAmountError(null, ''));
			else if (splits === 'no_members')
				setError({ key: 'expenses-recurring.form.error.noMembers' });
			else {
				setSplitError(aboSplitError(splits));
				// The message sits below the fields, often outside the visible area.
				requestAnimationFrame(() =>
					document.getElementById('recurring-splits-error')?.scrollIntoView({ block: 'nearest' }),
				);
			}
			return;
		}
		onSubmit({
			description: trimmedDescription,
			category,
			amountCents: parsedAmountCents,
			paidByMemberId,
			intervalMonths,
			nextDueAt: nextDueAtIso,
			splits,
		});
	}

	const splitPreview = buildSplits();
	return (
		<form onSubmit={handleSubmit} className="flex min-h-full flex-col gap-5">
			<FieldGroup>
				<Field data-disabled={submitting} data-invalid={Boolean(descriptionError)}>
					<FieldLabel htmlFor="recurring-description">{t('form.description')}</FieldLabel>
					<Input
						id="recurring-description"
						value={description}
						maxLength={DESCRIPTION_MAX_LENGTH}
						onChange={(event) => setDescription(event.target.value)}
						placeholder={t('form.descriptionPlaceholder')}
						disabled={submitting}
						enterKeyHint="next"
						className="text-base"
						aria-invalid={Boolean(descriptionError)}
						aria-describedby={descriptionError ? 'recurring-description-error' : undefined}
					/>
					<FieldError id="recurring-description-error">{descriptionError}</FieldError>
				</Field>
				<ExpenseCategoryField
					id="recurring-category"
					value={category}
					onChange={setCategory}
					disabled={submitting}
				/>
				<Field data-disabled={submitting} data-invalid={Boolean(amountError)}>
					<FieldLabel htmlFor="recurring-amount">{t('form.amount')}</FieldLabel>
					<InputGroup>
						<InputGroupInput
							id="recurring-amount"
							type="text"
							inputMode="decimal"
							value={amountStr}
							onChange={(event) => {
								setAmountStr(event.target.value);
								setSplitError(null);
							}}
							placeholder={t('form.amountPlaceholder')}
							disabled={submitting}
							enterKeyHint="next"
							className="min-h-11 font-mono tabular-nums text-base"
							aria-invalid={Boolean(amountError)}
							aria-describedby={amountError ? 'recurring-amount-error' : undefined}
						/>
						<InputGroupAddon align="inline-end">
							<InputGroupText>€</InputGroupText>
						</InputGroupAddon>
					</InputGroup>
					<FieldError id="recurring-amount-error">{amountError}</FieldError>
				</Field>
				<Field data-disabled={submitting}>
					<FieldLabel htmlFor="recurring-paid-by">{t('form.paidBy')}</FieldLabel>
					<NativeSelect
						id="recurring-paid-by"
						value={paidByMemberId}
						onChange={(event) => setPaidByMemberId(event.target.value)}
						disabled={submitting}
						className="w-full"
					>
						{payerOptions.map((member) => (
							<NativeSelectOption key={member.id} value={member.id}>
								{member.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				<Field data-disabled={submitting}>
					<FieldLabel htmlFor="recurring-interval">{t('form.interval')}</FieldLabel>
					<NativeSelect
						id="recurring-interval"
						value={intervalMonths}
						onChange={(event) => setIntervalMonths(Number(event.target.value))}
						disabled={submitting}
						className="w-full"
					>
						{!RECURRING_INTERVAL_OPTIONS.some((option) => option.value === intervalMonths) && (
							<NativeSelectOption value={intervalMonths}>
								{t('form.intervalOption.custom', { count: intervalMonths })}
							</NativeSelectOption>
						)}
						{RECURRING_INTERVAL_OPTIONS.map((option) => (
							<NativeSelectOption key={option.value} value={option.value}>
								{t(INTERVAL_OPTION_KEYS[option.value])}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				<Field data-disabled={submitting} data-invalid={Boolean(nextDueError)}>
					<FieldLabel htmlFor="recurring-next-due">
						{mode === 'create' ? t('form.firstDue') : t('form.nextDue')}
					</FieldLabel>
					<Input
						id="recurring-next-due"
						type="date"
						value={nextDueAt}
						onChange={(event) => setNextDueAt(event.target.value)}
						disabled={submitting}
						required
						aria-invalid={Boolean(nextDueError)}
						aria-describedby={nextDueError ? 'recurring-next-due-error' : undefined}
						className="text-base"
					/>
					{missedBookings > 0 && (
						<FieldDescription>
							{t('form.missedBookings', { count: missedBookings })}
						</FieldDescription>
					)}
					<FieldError id="recurring-next-due-error">{nextDueError}</FieldError>
				</Field>
				<RecurringSplitFields
					submitting={submitting}
					splitMode={splitMode}
					totalCents={parsedAmountCents}
					onSplitModeChange={(value) => {
						setSplitMode(value);
						setSplitError(null);
					}}
					splitCandidates={splitCandidates}
					participantIds={participantIds}
					onParticipantsChange={(ids) => {
						setParticipantIds(ids);
						setSplitError(null);
					}}
					manualSplits={manualSplits}
					onManualSplitChange={(memberId, value) => {
						setManualSplits((current) => ({ ...current, [memberId]: value }));
						setSplitError(null);
					}}
					splitError={splitError ? message(splitError) : null}
					splitPreview={splitPreview}
					paidByMemberId={paidByMemberId}
				/>
			</FieldGroup>
			<div className="sticky bottom-0 mt-auto flex flex-col gap-2 bg-popover pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
				{(formError || saveError) && (
					<Alert variant="destructive">
						<AlertDescription>{formError ?? saveError}</AlertDescription>
					</Alert>
				)}
				<Button type="submit" className="w-full whitespace-normal" disabled={submitting}>
					{submitting && <Spinner data-icon="inline-start" />}
					{mode === 'create' ? t('form.create') : t('form.save')}
				</Button>
				<Button
					type="button"
					variant="ghost"
					className="w-full"
					onClick={onCancel}
					disabled={submitting}
				>
					{t('form.cancel')}
				</Button>
			</div>
		</form>
	);
}

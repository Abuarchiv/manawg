'use client';

import { ImageUploader } from '@/components/wg/ImageUploader';
import type { Member } from '@/components/wg/WgContextProvider';
import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { ManualSplitSummary } from '@/features/expenses/components/ausgaben/ManualSplitSummary';
import { TextField } from '@/features/expenses/components/ausgaben/TextField';
import {
	DESCRIPTION_MAX,
	RECURRING_INTERVAL_OPTIONS,
} from '@/features/expenses/components/ausgaben/constants';
import type { RecurringExpense } from '@/features/expenses/components/ausgaben/expense-types';
import type { SplitMode } from '@/features/expenses/components/ausgaben/useExpenseForm';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

interface ExpenseFormSectionProps {
	description: string;
	setDescription: Dispatch<SetStateAction<string>>;
	amountStr: string;
	setAmountStr: Dispatch<SetStateAction<string>>;
	paidByMemberId: string;
	setPaidByMemberId: Dispatch<SetStateAction<string>>;
	members: Member[];
	payerOptions: Member[];
	splitCandidates: Member[];
	identityMemberId: string;
	splitMode: SplitMode;
	setSplitMode: Dispatch<SetStateAction<SplitMode>>;
	recurringIntervalMonths: number;
	setRecurringIntervalMonths: Dispatch<SetStateAction<number>>;
	manualSplits: Record<string, string>;
	setManualSplits: Dispatch<SetStateAction<Record<string, string>>>;
	imageUrl: string | null;
	setImageUrl: Dispatch<SetStateAction<string | null>>;
	shareCode: string;
	isEditingQueuedExpense: boolean;
	isEditingQueuedRecurring: boolean;
	formError: string | null;
	conflictExpenseId: string | null;
	onReloadServerVersion: () => void;
	onKeepDraft: () => void;
	savingRecurringTemplate: boolean;
	editingRecurringExpense: RecurringExpense | null;
	formSaving: boolean;
	onSaveRecurringTemplate: () => void;
	onCancel: () => void;
	onSubmit: () => void;
}

export function ExpenseFormSection({
	description,
	setDescription,
	amountStr,
	setAmountStr,
	paidByMemberId,
	setPaidByMemberId,
	members,
	payerOptions,
	splitCandidates,
	identityMemberId,
	splitMode,
	setSplitMode,
	recurringIntervalMonths,
	setRecurringIntervalMonths,
	manualSplits,
	setManualSplits,
	imageUrl,
	setImageUrl,
	shareCode,
	isEditingQueuedExpense,
	isEditingQueuedRecurring,
	formError,
	conflictExpenseId,
	onReloadServerVersion,
	onKeepDraft,
	savingRecurringTemplate,
	editingRecurringExpense,
	formSaving,
	onSaveRecurringTemplate,
	onCancel,
	onSubmit,
}: ExpenseFormSectionProps): React.ReactElement {
	return (
		// pb-36 sm:pb-5: mobile gets ~144px bottom-padding so the
		// sticky save/abbrechen panel below doesn't visually cover
		// the LAST form rows (Betrag/Bezahlt-von etc.) when the
		// form is taller than the viewport. Without this padding,
		// the opaque sticky panel sits on top of inputs that are
		// still scrollable but visually obscured — agent A iter10
		// reported this as P0 on iPhone 375×667.
		<section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-5 pb-56 sm:pb-5">
			<TextField
				label="Beschreibung"
				value={description}
				onChange={setDescription}
				maxLength={DESCRIPTION_MAX}
				placeholder="z. B. Wocheneinkauf"
				disabled={formSaving}
			/>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<TextField
					label="Betrag"
					value={amountStr}
					onChange={setAmountStr}
					inputMode="decimal"
					placeholder="0,00"
					suffix="€"
					disabled={formSaving}
				/>
				<div>
					<label
						htmlFor="paid-by"
						className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
					>
						Bezahlt von
					</label>
					<div className="relative">
						<select
							id="paid-by"
							value={paidByMemberId}
							onChange={(e) => setPaidByMemberId(e.target.value)}
							disabled={formSaving}
							className="block h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] pl-3 pr-9 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
						>
							{payerOptions.map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
									{m.id === identityMemberId ? ' (du)' : ''}
								</option>
							))}
						</select>
						<ChevronDown
							className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]"
							aria-hidden
						/>
					</div>
				</div>
			</div>

			<div>
				<div className="mb-1.5 text-[13px] font-medium text-[var(--text-1)]">Aufteilung</div>
				<div className="inline-flex w-full rounded-md border border-[var(--border)] p-0.5">
					{(['equal', 'manual'] as const).map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => setSplitMode(m)}
							disabled={formSaving}
							aria-label={m === 'equal' ? 'Aufteilung: Gleichmäßig' : 'Aufteilung: Manuell'}
							aria-pressed={splitMode === m}
							className={`h-11 flex-1 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
								splitMode === m
									? 'bg-[var(--text-1)] text-[var(--bg-base)]'
									: 'text-[var(--text-2)] hover:text-[var(--text-1)]'
							}`}
						>
							{m === 'equal' ? 'Gleichmäßig' : 'Manuell'}
						</button>
					))}
				</div>
			</div>

			<div>
				<div className="mb-1.5 text-[13px] font-medium text-[var(--text-1)]">
					Fixkosten-Intervall
				</div>
				<div className="grid grid-cols-2 gap-1 rounded-md border border-[var(--border)] p-0.5 sm:grid-cols-4">
					{RECURRING_INTERVAL_OPTIONS.map(({ value, label }) => (
						<button
							key={value}
							type="button"
							onClick={() => setRecurringIntervalMonths(value)}
							disabled={formSaving}
							aria-pressed={recurringIntervalMonths === value}
							className={`h-11 rounded-md px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
								recurringIntervalMonths === value
									? 'bg-[var(--text-1)] text-[var(--bg-base)]'
									: 'text-[var(--text-2)] hover:text-[var(--text-1)]'
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{splitMode === 'manual' && (
				<div className="space-y-2">
					{splitCandidates.map((m) => (
						<div key={m.id} className="flex items-center gap-2">
							<MemberAvatar name={m.name} color={m.color ?? null} size={24} />
							<span className="w-28 truncate text-[13.5px] text-[var(--text-1)]">{m.name}</span>
							<div className="relative flex-1">
								<input
									type="text"
									inputMode="decimal"
									value={manualSplits[m.id] ?? ''}
									onChange={(e) => setManualSplits((prev) => ({ ...prev, [m.id]: e.target.value }))}
									disabled={formSaving}
									placeholder="0,00"
									aria-label={`Anteil ${m.name} in Euro`}
									className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 pr-7 text-base tabular-nums text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
								/>
								<span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-[var(--text-3)]">
									€
								</span>
							</div>
						</div>
					))}
					<ManualSplitSummary
						amountStr={amountStr}
						manualSplits={manualSplits}
						members={members}
						setManualSplits={setManualSplits}
					/>
				</div>
			)}

			<div>
				<div className="mb-1.5 text-[13px] font-medium text-[var(--text-1)]">Beleg (optional)</div>
				<ImageUploader
					shareCode={shareCode}
					purpose="expense"
					value={imageUrl}
					onChange={setImageUrl}
					disabled={formSaving}
					imageLabel="Beleg"
				/>
			</div>

			{(isEditingQueuedExpense || isEditingQueuedRecurring) && (
				<div className="rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/5 px-3 py-2 text-[12.5px] text-[var(--accent)]">
					{isEditingQueuedRecurring
						? 'Du bearbeitest eine wartende Fixkosten-Vorlage.'
						: 'Du bearbeitest eine wartende Ausgabe.'}
				</div>
			)}

			{formError && (
				<div
					role="alert"
					className="space-y-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]"
				>
					<p>{formError}</p>
					{conflictExpenseId && (
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={onReloadServerVersion}
								className="inline-flex h-11 items-center rounded-md bg-[var(--danger)] px-3 text-[12px] font-medium text-[var(--danger-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								Server-Version laden
							</button>
							<button
								type="button"
								onClick={onKeepDraft}
								className="inline-flex h-11 items-center rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								Meinen Entwurf behalten
							</button>
						</div>
					)}
				</div>
			)}

			{/* Mobile: sticky actions above bottom nav; sm+: right-aligned row. Min 44px tap targets. */}
			<div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] -mx-4 flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:pt-1">
				{!isEditingQueuedExpense && !isEditingQueuedRecurring && (
					<button
						type="button"
						onClick={onSaveRecurringTemplate}
						disabled={formSaving}
						className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
					>
						{savingRecurringTemplate && (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
						)}
						{editingRecurringExpense ? 'Vorlage speichern' : 'Als Vorlage merken'}
					</button>
				)}
				<button
					type="button"
					onClick={onCancel}
					disabled={formSaving}
					aria-label="Ausgabe abbrechen"
					className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md px-3 text-[13px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
				>
					Abbrechen
				</button>
				<button
					type="button"
					onClick={onSubmit}
					disabled={formSaving}
					aria-label={
						isEditingQueuedRecurring ? 'Fixkosten-Vorlage speichern' : 'Ausgabe speichern'
					}
					className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
				>
					{formSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
					{isEditingQueuedRecurring ? 'Vorlage speichern' : 'Speichern'}
				</button>
			</div>
		</section>
	);
}

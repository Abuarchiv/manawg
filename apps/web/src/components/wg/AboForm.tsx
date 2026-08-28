'use client';

import { ALERT_DANGER } from '@/components/ui/styles';
import type { AboSplit, MemberOption } from '@/components/wg/abos-types';
import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const DESCRIPTION_MAX = 200;
const AMOUNT_MIN_EUROS = 0.01;
const AMOUNT_MAX_EUROS = 1_000_000;

const INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' },
	{ value: 3, label: '3 Monate (Quartal)' },
	{ value: 6, label: '6 Monate' },
	{ value: 12, label: '12 Monate (Jahr)' },
] as const;

export interface AboFormValues {
	description: string;
	amountCents: number;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	splits: AboSplit[];
}

interface AboFormProps {
	mode: 'create' | 'edit';
	members: MemberOption[];
	initial?: AboFormValues;
	defaultPaidByMemberId: string;
	submitting: boolean;
	onCancel: () => void;
	onSubmit: (values: AboFormValues) => void;
}

type SplitMode = 'equal' | 'manual';

function buildEqualSplits(members: MemberOption[], amountCents: number): AboSplit[] {
	if (members.length === 0) return [];
	const base = Math.floor(amountCents / members.length);
	const remainder = amountCents - base * members.length;
	return members.map((member, index) => ({
		debtorMemberId: member.id,
		amountCents: base + (index < remainder ? 1 : 0),
	}));
}

function todayInputValue(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function isoDateToInput(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return todayInputValue();
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function inputDateToIso(value: string): string {
	const parts = value.split('-').map((part) => Number.parseInt(part, 10));
	const year = parts[0];
	const month = parts[1];
	const day = parts[2];
	if (year === undefined || month === undefined || day === undefined) {
		return new Date().toISOString();
	}
	return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString();
}

function initialSplitMode(initial: AboFormValues | undefined, members: MemberOption[]): SplitMode {
	if (!initial) return 'equal';
	const equal = buildEqualSplits(members, initial.amountCents);
	const sameLength = initial.splits.length === equal.length;
	if (!sameLength) return 'manual';
	const sortedInitial = [...initial.splits].sort((a, b) =>
		a.debtorMemberId.localeCompare(b.debtorMemberId),
	);
	const sortedEqual = [...equal].sort((a, b) => a.debtorMemberId.localeCompare(b.debtorMemberId));
	const allEqual = sortedInitial.every((split, idx) => {
		const counterpart = sortedEqual[idx];
		return (
			counterpart !== undefined &&
			split.debtorMemberId === counterpart.debtorMemberId &&
			split.amountCents === counterpart.amountCents
		);
	});
	return allEqual ? 'equal' : 'manual';
}

function initialManualMap(initial: AboFormValues | undefined): Record<string, string> {
	if (!initial) return {};
	return Object.fromEntries(
		initial.splits.map((split) => [
			split.debtorMemberId,
			formatEuroInput(split.amountCents / CENTS_PER_EURO),
		]),
	);
}

export function AboForm({
	mode,
	members,
	initial,
	defaultPaidByMemberId,
	submitting,
	onCancel,
	onSubmit,
}: AboFormProps) {
	// Only active members are offered for new selections ("aus Listen raus").
	// Moved-out members are re-added below where an existing abo still references
	// them, so editing never silently drops or reassigns a participant.
	const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);

	const [description, setDescription] = useState(initial?.description ?? '');
	const [amountStr, setAmountStr] = useState(
		initial ? formatEuroInput(initial.amountCents / CENTS_PER_EURO) : '',
	);
	const [paidByMemberId, setPaidByMemberId] = useState(
		initial?.paidByMemberId ?? defaultPaidByMemberId,
	);
	const [intervalMonths, setIntervalMonths] = useState(initial?.intervalMonths ?? 1);
	const [nextDueAt, setNextDueAt] = useState(
		initial ? isoDateToInput(initial.nextDueAt) : todayInputValue(),
	);
	const [splitMode, setSplitMode] = useState<SplitMode>(initialSplitMode(initial, activeMembers));
	const [manualSplits, setManualSplits] = useState<Record<string, string>>(
		initialManualMap(initial),
	);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!initial) return;
		setDescription(initial.description);
		setAmountStr(formatEuroInput(initial.amountCents / CENTS_PER_EURO));
		setPaidByMemberId(initial.paidByMemberId);
		setIntervalMonths(initial.intervalMonths);
		setNextDueAt(isoDateToInput(initial.nextDueAt));
		setSplitMode(initialSplitMode(initial, activeMembers));
		setManualSplits(initialManualMap(initial));
	}, [initial, activeMembers]);

	const parsedAmountCents = useMemo(() => {
		const euros = parseEuroAmount(amountStr);
		if (euros === null || euros < AMOUNT_MIN_EUROS || euros > AMOUNT_MAX_EUROS) return null;
		return Math.round(euros * CENTS_PER_EURO);
	}, [amountStr]);

	// Payer dropdown offers active members, but keeps the currently selected
	// payer visible even if they moved out — otherwise saving would silently
	// reassign the abo to someone else.
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

	function buildSplits(): AboSplit[] | string {
		if (parsedAmountCents === null) return 'amount_invalid';
		if (splitMode === 'equal') {
			const equal = buildEqualSplits(activeMembers, parsedAmountCents);
			if (equal.length === 0) return 'no_members';
			return equal;
		}
		const splits: AboSplit[] = [];
		let sum = 0;
		for (const member of members) {
			const raw = manualSplits[member.id] ?? '';
			if (raw.trim().length === 0) continue;
			const value = parseEuroAmount(raw);
			if (value === null || value <= 0) continue;
			const cents = Math.round(value * CENTS_PER_EURO);
			splits.push({ debtorMemberId: member.id, amountCents: cents });
			sum += cents;
		}
		if (splits.length === 0) return 'splits_empty';
		if (sum !== parsedAmountCents) return 'splits_mismatch';
		return splits;
	}

	function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		setError(null);
		const trimmedDescription = description.trim();
		if (trimmedDescription.length === 0 || trimmedDescription.length > DESCRIPTION_MAX) {
			setError('Beschreibung fehlt.');
			return;
		}
		if (parsedAmountCents === null) {
			setError('Betrag ungültig.');
			return;
		}
		const splits = buildSplits();
		if (typeof splits === 'string') {
			if (splits === 'amount_invalid') setError('Betrag ungültig.');
			else if (splits === 'splits_empty')
				setError('Aufteilung leer — gib mindestens einen Betrag ein.');
			else if (splits === 'splits_mismatch')
				setError('Beträge stimmen nicht überein — Summe muss exakt dem Gesamtbetrag entsprechen.');
			else setError('Keine Mitglieder vorhanden.');
			return;
		}
		onSubmit({
			description: trimmedDescription,
			amountCents: parsedAmountCents,
			paidByMemberId,
			intervalMonths,
			nextDueAt: inputDateToIso(nextDueAt),
			splits,
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div>
				<label
					htmlFor="abo-description"
					className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
				>
					Beschreibung
				</label>
				<input
					id="abo-description"
					type="text"
					value={description}
					maxLength={DESCRIPTION_MAX}
					onChange={(event) => setDescription(event.target.value)}
					placeholder="z. B. Netflix"
					disabled={submitting}
					className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-70"
				/>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<label
						htmlFor="abo-amount"
						className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
					>
						Betrag
					</label>
					<div className="relative">
						<input
							id="abo-amount"
							type="text"
							inputMode="decimal"
							value={amountStr}
							onChange={(event) => setAmountStr(event.target.value)}
							placeholder="0,00"
							disabled={submitting}
							className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] pl-3 pr-9 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-70"
						/>
						<span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--text-3)]">
							€
						</span>
					</div>
				</div>
				<div>
					<label
						htmlFor="abo-interval"
						className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
					>
						Intervall
					</label>
					<select
						id="abo-interval"
						value={intervalMonths}
						onChange={(event) => setIntervalMonths(Number(event.target.value))}
						disabled={submitting}
						className="block h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-70"
					>
						{INTERVAL_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<label
						htmlFor="abo-next-due"
						className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
					>
						Erste Fälligkeit
					</label>
					<input
						id="abo-next-due"
						type="date"
						value={nextDueAt}
						onChange={(event) => setNextDueAt(event.target.value)}
						disabled={submitting}
						className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-70"
					/>
				</div>
				<div>
					<label
						htmlFor="abo-paid-by"
						className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
					>
						Bezahlt von
					</label>
					<select
						id="abo-paid-by"
						value={paidByMemberId}
						onChange={(event) => setPaidByMemberId(event.target.value)}
						disabled={submitting}
						className="block h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-70"
					>
						{payerOptions.map((member) => (
							<option key={member.id} value={member.id}>
								{member.name}
							</option>
						))}
					</select>
				</div>
			</div>
			<fieldset>
				<legend className="mb-1.5 text-[13px] font-medium text-[var(--text-1)]">Aufteilung</legend>
				<div className="flex gap-2">
					<label className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-2)] transition-colors has-[:checked]:border-[var(--text-1)] has-[:checked]:bg-[var(--surface)] has-[:checked]:text-[var(--text-1)] has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] has-[:focus-visible]:ring-offset-2">
						<input
							type="radio"
							name="abo-split"
							value="equal"
							checked={splitMode === 'equal'}
							onChange={() => setSplitMode('equal')}
							disabled={submitting}
							className="sr-only"
						/>
						Gleichmäßig
					</label>
					<label className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-2)] transition-colors has-[:checked]:border-[var(--text-1)] has-[:checked]:bg-[var(--surface)] has-[:checked]:text-[var(--text-1)] has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)] has-[:focus-visible]:ring-offset-2">
						<input
							type="radio"
							name="abo-split"
							value="manual"
							checked={splitMode === 'manual'}
							onChange={() => setSplitMode('manual')}
							disabled={submitting}
							className="sr-only"
						/>
						Benutzerdefiniert
					</label>
				</div>
				{splitMode === 'manual' && (
					<ul className="mt-3 space-y-2">
						{splitCandidates.map((member) => (
							<li
								key={member.id}
								className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2"
							>
								<span className="truncate text-[13.5px] text-[var(--text-1)]">{member.name}</span>
								<div className="relative w-28">
									<input
										type="text"
										inputMode="decimal"
										value={manualSplits[member.id] ?? ''}
										onChange={(event) =>
											setManualSplits((current) => ({
												...current,
												[member.id]: event.target.value,
											}))
										}
										placeholder="0,00"
										aria-label={`Anteil ${member.name} in Euro`}
										disabled={submitting}
										className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] pl-2 pr-7 text-right text-base text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-70"
									/>
									<span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[var(--text-3)]">
										€
									</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</fieldset>
			{error && (
				<p role="alert" className={ALERT_DANGER}>
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					disabled={submitting}
					className="inline-flex h-11 items-center rounded-xl border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
				>
					Abbrechen
				</button>
				<button
					type="submit"
					disabled={submitting}
					className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--text-1)] px-4 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
					{mode === 'create' ? 'Abo anlegen' : 'Speichern'}
				</button>
			</div>
		</form>
	);
}

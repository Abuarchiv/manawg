'use client';
import type { ChoreMember, RecurrenceType } from '@/features/chores/components/chore-types';
import {
	INTERVAL_PRESETS_DAYS,
	INTERVAL_PRESETS_MONTHS,
} from '@/features/chores/components/constants';
import { TITLE_MAX } from '@/features/chores/components/constants';
import { ChevronDown, Plus } from 'lucide-react';
import type React from 'react';

interface ChoreFormProps {
	title: string;
	onTitleChange: (value: string) => void;
	titleInputRef: React.RefObject<HTMLInputElement | null>;
	interval: number;
	recurrenceType: RecurrenceType;
	onRecurrenceUnitToggle: (unit: RecurrenceType) => void;
	onIntervalPresetSelect: (interval: number, unit: RecurrenceType) => void;
	assignedMemberId: string;
	onAssignedMemberIdChange: (value: string) => void;
	members: ChoreMember[];
	pending: boolean;
	onSubmit: () => void;
}

export function ChoreForm({
	title,
	onTitleChange,
	titleInputRef,
	interval,
	recurrenceType,
	onRecurrenceUnitToggle,
	onIntervalPresetSelect,
	assignedMemberId,
	onAssignedMemberIdChange,
	members,
	pending,
	onSubmit,
}: ChoreFormProps): React.ReactElement {
	return (
		<form
			id="add-chore-form"
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
			className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-5"
		>
			<div>
				<label
					htmlFor="chore-title"
					className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
				>
					Aufgabe
				</label>
				<input
					id="chore-title"
					ref={titleInputRef}
					type="text"
					value={title}
					onChange={(e) => onTitleChange(e.target.value)}
					maxLength={TITLE_MAX}
					placeholder="z. B. Müll rausbringen"
					disabled={pending}
					className="block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[15px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
				/>
			</div>

			<div>
				<div className="mb-1.5 flex items-baseline justify-between gap-2">
					<div className="text-[13px] font-medium text-[var(--text-1)]">Rhythmus</div>
					{/*
						Toggle-button-group pattern: <button aria-pressed> instead of
						role="radio" because the latter would (per biome a11y rule)
						demand semantic <input type="radio"> elements. The aria-pressed
						pattern is announced as "selected/unselected" by VoiceOver and
						works fine for two-option switches.
					*/}
					<div
						aria-label="Wiederholung in Tagen oder Monaten"
						className="inline-flex rounded-md border border-[var(--border)] p-0.5"
					>
						{(['days', 'months'] as const).map((unit) => (
							<button
								key={unit}
								type="button"
								aria-pressed={recurrenceType === unit}
								onClick={() => onRecurrenceUnitToggle(unit)}
								disabled={pending}
								className={`h-11 rounded-md px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
									recurrenceType === unit
										? 'bg-[var(--text-1)] text-[var(--bg-base)]'
										: 'text-[var(--text-2)] hover:text-[var(--text-1)]'
								}`}
							>
								{unit === 'days' ? 'Tage' : 'Monate'}
							</button>
						))}
					</div>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{(recurrenceType === 'months' ? INTERVAL_PRESETS_MONTHS : INTERVAL_PRESETS_DAYS).map(
						(p) => (
							<button
								key={`${p.unit}-${p.interval}`}
								type="button"
								aria-pressed={interval === p.interval && recurrenceType === p.unit}
								onClick={() => onIntervalPresetSelect(p.interval, p.unit)}
								disabled={pending}
								className={`inline-flex h-11 items-center rounded-md border px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
									interval === p.interval && recurrenceType === p.unit
										? 'border-[var(--text-1)] bg-[var(--text-1)] text-[var(--bg-base)]'
										: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
								}`}
							>
								{p.label}
							</button>
						),
					)}
				</div>
				{recurrenceType === 'months' && (
					<p className="mt-1.5 text-[11.5px] text-[var(--text-3)]">
						Kalendergenau: 12× monatlich landet wieder am gleichen Tag — keine 5 Tage Drift.
					</p>
				)}
			</div>

			<div>
				<label
					htmlFor="chore-assigned"
					className="mb-1.5 block text-[13px] font-medium text-[var(--text-1)]"
				>
					Zuständig
				</label>
				<div className="relative">
					<select
						id="chore-assigned"
						value={assignedMemberId}
						onChange={(e) => onAssignedMemberIdChange(e.target.value)}
						disabled={pending}
						className="block h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] pl-3 pr-9 text-[15px] text-[var(--text-1)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
					>
						<option value="">— niemand —</option>
						{members.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</select>
					<ChevronDown
						className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]"
						aria-hidden
					/>
				</div>
			</div>

			<div className="flex justify-end pt-1">
				<button
					type="submit"
					disabled={title.trim().length === 0 || pending}
					aria-label="Aufgabe hinzufügen"
					className="btn-app-primary"
				>
					<Plus className="h-3.5 w-3.5" aria-hidden />
					{pending ? 'Speichert...' : 'Hinzufügen'}
				</button>
			</div>
		</form>
	);
}

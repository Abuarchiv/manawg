'use client';

import { apiFetch } from '@/core/infra/api-client';
import { berlinDayKey, instantAtBerlinWallTime } from '@/core/utils/berlin-day';
import { choreEditErrorMessage } from '@/features/chores/chore-errors';
import type { Chore, RecurrenceType } from '@/features/chores/components/chore-types';
import { TITLE_MAX } from '@/features/chores/components/constants';
import { useState } from 'react';
import type { ChorePageContext } from './chore-page-context';

const NOON_MINUTES = 12 * 60;

/** Edit an existing chore: title, rhythm, due date and assignee, sending only what changed. */
export function useChoreEdit(ctx: ChorePageContext) {
	const { encodedShareCode, identity, toast, updateChores, load } = ctx;
	const [editing, setEditing] = useState<Chore | null>(null);
	const [title, setTitle] = useState('');
	const [interval, setInterval] = useState(7);
	const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('days');
	const [assigned, setAssigned] = useState('');
	const [dueDate, setDueDate] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	function open(chore: Chore): void {
		setEditing(chore);
		setTitle(chore.title);
		setInterval(chore.intervalDays);
		setRecurrenceType(chore.recurrenceType);
		setAssigned(chore.assignedMemberId ?? '');
		setDueDate(berlinDayKey(new Date(chore.nextDueAt)));
		setError(null);
	}

	function close(): void {
		if (pending) return;
		setEditing(null);
		setError(null);
	}

	async function submit(): Promise<void> {
		if (!editing || pending) return;
		const trimmed = title.trim();
		if (trimmed.length === 0 || trimmed.length > TITLE_MAX) {
			setError(`Der Titel muss 1 bis ${TITLE_MAX} Zeichen haben.`);
			return;
		}
		const patch: Record<string, unknown> = {};
		if (trimmed !== editing.title) patch.title = trimmed;
		if (interval !== editing.intervalDays || recurrenceType !== editing.recurrenceType) {
			patch.intervalDays = interval;
			patch.recurrenceType = recurrenceType;
		}
		if (assigned !== (editing.assignedMemberId ?? '')) patch.assignedMemberId = assigned || null;
		if (dueDate !== berlinDayKey(new Date(editing.nextDueAt))) {
			const instant = instantAtBerlinWallTime(dueDate, NOON_MINUTES);
			if (!instant) {
				setError('Das Fälligkeitsdatum ist ungültig.');
				return;
			}
			patch.nextDueAt = instant.toISOString();
		}
		if (Object.keys(patch).length === 0) {
			setEditing(null);
			return;
		}
		setPending(true);
		setError(null);
		const result = await apiFetch<{ chore: Chore }>(
			`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(editing.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify({
					...patch,
					...(editing.updatedAt ? { expectedUpdatedAt: editing.updatedAt } : {}),
				}),
			},
		);
		setPending(false);
		if (!result.ok) {
			setError(choreEditErrorMessage(result));
			if (result.error === 'chore_changed' || result.error === 'chore_not_found') void load(false);
			return;
		}
		const saved = result.data.chore;
		updateChores((current) =>
			current.map((item) =>
				item.id === editing.id
					? {
							...item,
							title: saved.title,
							intervalDays: saved.intervalDays,
							recurrenceType: saved.recurrenceType,
							nextDueAt: saved.nextDueAt,
							assignedMemberId: saved.assignedMemberId,
						}
					: item,
			),
		);
		setEditing(null);
		toast.success('Aufgabe gespeichert.');
		void load(false);
	}

	return {
		editing,
		title,
		setTitle: (value: string) => {
			setTitle(value);
			setError(null);
		},
		interval,
		recurrenceType,
		toggleRecurrenceUnit: (unit: RecurrenceType) => {
			setRecurrenceType(unit);
			// Same defaults as the create form, so the number keeps a meaning in the new unit.
			setInterval(unit === 'months' ? 1 : 7);
		},
		selectIntervalPreset: (value: number, unit: RecurrenceType) => {
			setInterval(value);
			setRecurrenceType(unit);
		},
		assigned,
		setAssigned,
		dueDate,
		setDueDate,
		error,
		pending,
		open,
		close,
		submit,
	};
}

import { dueAtForDay, dueDayKey } from '@/features/chores/chore-due-date';
import type { Chore } from '@/features/chores/components/chore-types';

/** The fields `PATCH /chores/<id>` accepts from the edit form; only changed ones are set. */
export interface ChoreEditChanges {
	title?: string;
	assignedMemberId?: string | null;
	nextDueAt?: string;
	intervalDays?: number;
	recurrenceType?: Chore['recurrenceType'];
}

/** The values the edit form holds while it is open. */
export interface ChoreEditForm {
	title: string;
	assigned: string;
	dueDay: string;
	interval: number;
	recurrenceType: Chore['recurrenceType'];
}

/** How an edit save ended; a conflict means another change landed first and the list reloads. */
export type ChoreEditResult = 'saved' | 'conflict' | 'failed';

/** Compares the form with the stored chore; an empty result means nothing to save. */
export function diffChoreEdit(chore: Chore, form: ChoreEditForm): ChoreEditChanges {
	const changes: ChoreEditChanges = {};
	const title = form.title.trim();
	if (title && title !== chore.title) changes.title = title;
	if (form.assigned !== (chore.assignedMemberId ?? '')) {
		changes.assignedMemberId = form.assigned || null;
	}
	if (form.dueDay && form.dueDay !== dueDayKey(chore.nextDueAt)) {
		const dueAt = dueAtForDay(form.dueDay, chore.nextDueAt);
		if (dueAt) changes.nextDueAt = dueAt;
	}
	if (form.interval !== chore.intervalDays || form.recurrenceType !== chore.recurrenceType) {
		changes.intervalDays = form.interval;
		changes.recurrenceType = form.recurrenceType;
	}
	return changes;
}

/** After a version conflict: untouched fields follow `latest`, touched fields keep what was typed. */
export function rebaseChoreEdit(base: Chore, latest: Chore, form: ChoreEditForm): ChoreEditForm {
	const rhythmTouched =
		form.interval !== base.intervalDays || form.recurrenceType !== base.recurrenceType;
	return {
		title: form.title.trim() === base.title ? latest.title : form.title,
		assigned:
			form.assigned === (base.assignedMemberId ?? '')
				? (latest.assignedMemberId ?? '')
				: form.assigned,
		dueDay: form.dueDay === dueDayKey(base.nextDueAt) ? dueDayKey(latest.nextDueAt) : form.dueDay,
		interval: rhythmTouched ? form.interval : latest.intervalDays,
		recurrenceType: rhythmTouched ? form.recurrenceType : latest.recurrenceType,
	};
}

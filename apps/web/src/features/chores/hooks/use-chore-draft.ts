import { isEmptyModuleDraft, readDraft, writeDraft } from '@/core/offline/drafts';
import type { RecurrenceType } from '@/features/chores/components/chore-types';
import { useEffect, useRef, useState } from 'react';
import type { AbsenceFormState } from './use-absences';

/** Fields of the "Putzaufgabe hinzufügen" form. */
export function useChoreFormFields() {
	const [newTitle, setNewTitle] = useState('');
	const [newInterval, setNewInterval] = useState(7);
	const [newRecurrenceType, setNewRecurrenceType] = useState<RecurrenceType>('days');
	const [newAssigned, setNewAssigned] = useState<string>('');
	/** Only an assignee the member picked is part of the draft, not the automatic suggestion. */
	const assigneeTouchedRef = useRef(false);

	function resetFields(): void {
		setNewTitle('');
		setNewInterval(7);
		setNewRecurrenceType('days');
		setNewAssigned('');
	}

	function handleAssignedMemberIdChange(value: string): void {
		assigneeTouchedRef.current = true;
		setNewAssigned(value);
	}

	function handleRecurrenceUnitToggle(unit: RecurrenceType): void {
		setNewRecurrenceType(unit);
		// Snap to a sensible default for the new unit so the number doesn't
		// become semantically meaningless (e.g. "30 Monate" after switching
		// from "30 Tage").
		if (unit === 'months') setNewInterval(1);
		else setNewInterval(7);
	}

	function handleIntervalPresetSelect(interval: number, unit: RecurrenceType): void {
		setNewInterval(interval);
		setNewRecurrenceType(unit);
	}

	return {
		newTitle,
		setNewTitle,
		newInterval,
		setNewInterval,
		newRecurrenceType,
		setNewRecurrenceType,
		newAssigned,
		setNewAssigned,
		assigneeTouchedRef,
		resetFields,
		handleAssignedMemberIdChange,
		handleRecurrenceUnitToggle,
		handleIntervalPresetSelect,
	};
}

type ChoreFormFields = ReturnType<typeof useChoreFormFields>;

type StoredChoreDraft = {
	title?: string;
	intervalDays?: number;
	recurrenceType?: RecurrenceType;
	assignedMemberId?: string;
	assigneeTouched?: boolean;
	absenceMemberId?: string;
	absenceStartDate?: string;
	absenceEndDate?: string;
	absenceReason?: string;
	openAbsencesPanel?: boolean;
	queueEditId?: string;
};

interface ChoreDraftSyncInput {
	draftKey: string;
	memberId: string;
	fields: ChoreFormFields;
	absenceForm: AbsenceFormState;
	queueEditId: string | null;
	setQueueEditId: (id: string | null) => void;
	setShowForm: (show: boolean) => void;
}

/**
 * Keeps the chore form (with the absence fields that share its draft) in a localStorage
 * draft: restores it once, then writes every change. Returns whether the restore ran.
 */
export function useChoreDraftSync({
	draftKey,
	memberId,
	fields,
	absenceForm,
	queueEditId,
	setQueueEditId,
	setShowForm,
}: ChoreDraftSyncInput): boolean {
	const [draftHydrated, setDraftHydrated] = useState(false);
	const {
		newTitle,
		setNewTitle,
		newInterval,
		setNewInterval,
		newRecurrenceType,
		setNewRecurrenceType,
		newAssigned,
		setNewAssigned,
		assigneeTouchedRef,
	} = fields;
	const {
		absenceMemberId,
		setAbsenceMemberId,
		absenceStart,
		setAbsenceStart,
		absenceEnd,
		setAbsenceEnd,
		absenceReason,
		setAbsenceReason,
	} = absenceForm;

	// biome-ignore lint/correctness/useExhaustiveDependencies: restores once per draft key; the form setters are stable.
	useEffect(() => {
		const draft = readDraft<StoredChoreDraft>(draftKey);
		if (!draft) {
			setDraftHydrated(true);
			return;
		}
		const { assigneeTouched: savedAssigneeTouched, ...formDraft } = draft;
		// Older drafts without assigneeTouched stored the automatic suggestion (mostly
		// the member themselves); that alone must not make the form pop open.
		if (typeof savedAssigneeTouched !== 'boolean' && formDraft.assignedMemberId === memberId) {
			formDraft.assignedMemberId = '';
		}
		if (!isEmptyModuleDraft('chore', formDraft, memberId)) {
			assigneeTouchedRef.current =
				typeof savedAssigneeTouched === 'boolean' ? savedAssigneeTouched : true;
			// A stored draft is restored silently and shows once "Putzaufgabe hinzufügen" is
			// tapped, so the form does not pop open on every visit. Only "Bearbeiten" from the
			// offline queue opens it directly (a user action).
			if (formDraft.queueEditId) setShowForm(true);
		}
		if (draft.title) setNewTitle(draft.title);
		if (draft.intervalDays) setNewInterval(draft.intervalDays);
		if (draft.recurrenceType === 'months' || draft.recurrenceType === 'days')
			setNewRecurrenceType(draft.recurrenceType);
		if (typeof draft.assignedMemberId === 'string') setNewAssigned(draft.assignedMemberId);
		if (draft.absenceMemberId) setAbsenceMemberId(draft.absenceMemberId);
		if (draft.absenceStartDate) setAbsenceStart(draft.absenceStartDate.slice(0, 10));
		if (draft.absenceEndDate) setAbsenceEnd(draft.absenceEndDate.slice(0, 10));
		if (draft.absenceReason !== undefined) setAbsenceReason(draft.absenceReason);
		if (draft.queueEditId) setQueueEditId(draft.queueEditId);
		setDraftHydrated(true);
	}, [draftKey, memberId, setAbsenceEnd, setAbsenceMemberId, setAbsenceReason, setAbsenceStart]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: assigneeTouchedRef is read at write time on purpose.
	useEffect(() => {
		if (!draftHydrated) return;
		const { assigneeTouched: _previousAssigneeTouched, ...previousDraft } =
			readDraft<Record<string, unknown>>(draftKey) ?? {};
		void _previousAssigneeTouched;
		const draft = {
			...previousDraft,
			title: newTitle,
			recurrenceType: newRecurrenceType,
			intervalDays: newInterval,
			// Only a chosen assignee is a draft; the automatic suggestion would otherwise
			// make the empty form pop open again on every visit.
			assignedMemberId: assigneeTouchedRef.current ? newAssigned : '',
			absenceMemberId,
			absenceStartDate: absenceStart,
			absenceEndDate: absenceEnd,
			absenceReason,
			queueEditId,
		};
		writeDraft(
			draftKey,
			isEmptyModuleDraft('chore', draft, memberId)
				? draft
				: { ...draft, assigneeTouched: assigneeTouchedRef.current },
		);
	}, [
		absenceEnd,
		absenceMemberId,
		absenceReason,
		absenceStart,
		draftHydrated,
		draftKey,
		memberId,
		newAssigned,
		newInterval,
		newRecurrenceType,
		newTitle,
		queueEditId,
	]);

	return draftHydrated;
}

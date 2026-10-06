import { apiFetch } from '@/core/infra/api-client';
import {
	type NotificationWarning,
	notificationWarningMessage,
} from '@/core/notifications/notification-warning';
import {
	buildDraftKey,
	isEmptyModuleDraft,
	readDraft,
	removeDraft,
	writeDraft,
} from '@/core/offline/drafts';
import {
	enqueueOfflineAction,
	isOfflineActionQueued,
	updateOfflineQueue,
} from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
	QUEUE_EDIT_ALREADY_SENT_MESSAGE,
} from '@/core/offline/offline-copy';
import {
	type OfflineActionType,
	createOfflineIdempotencyKey,
	createQueuedChore,
} from '@/core/offline/offline-queue';
import { choreCreateErrorMessage } from '@/features/chores/chore-errors';
import type { ChoreFairness } from '@/features/chores/chore-fairness';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import type { RecurrenceType } from '@/features/chores/components/chore-types';
import { type QUICK_CHORE_TEMPLATES, TITLE_MAX } from '@/features/chores/components/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChorePageContext } from './chore-page-context';
import type { AbsenceFormState } from './use-absences';

export type ChoreSuggestion = {
	title: string;
	intervalDays: number;
	recurrenceType: RecurrenceType;
};
type ChoreCreateResponse = { chore: unknown; warning: NotificationWarning };

/** Der aus einer Offline-Warteschlange zurückgeholte Eintrag, den der Entwurf gerade bearbeitet. */
export interface QueueEdit {
	setQueueEditId: (id: string | null) => void;
	clearEditedQueueItem: (expectedTypes?: OfflineActionType[]) => Promise<boolean>;
	editedQueueItemWasSent: (type: OfflineActionType) => boolean;
}

/** Aufgabe anlegen: Formular, localStorage-Entwurf (inkl. Abwesenheitsfelder), Vorschläge und Speichern. */
export function useChoreCreate(
	ctx: ChorePageContext,
	absenceForm: AbsenceFormState,
	prefillTitle: string | null,
	suggestedAssignee: ChoreFairness['suggestedAssignee'],
) {
	const {
		wg,
		identity,
		encodedShareCode,
		isPending,
		startPending,
		endPending,
		setActionError,
		setActionNotice,
		updateChores,
		load,
		refreshCount,
	} = ctx;
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
	const [showForm, setShowForm] = useState(false);
	const [pendingSuggestion, setPendingSuggestion] = useState<ChoreSuggestion | null>(null);
	const [confirmSuggestion, setConfirmSuggestion] = useState(false);
	const [newTitle, setNewTitle] = useState('');
	const [newInterval, setNewInterval] = useState(7);
	const [newRecurrenceType, setNewRecurrenceType] = useState<RecurrenceType>('days');
	const [newAssigned, setNewAssigned] = useState<string>('');
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'chore');
	const appliedPrefillRef = useRef<string | null>(null);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const assigneeTouchedRef = useRef(false);
	const choreCreateRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

	// Ein älterer Fehler (Erledigen, Tauschen …) gehört nicht ins frisch geöffnete Formular.
	useEffect(() => {
		if (showForm) setActionError(null);
	}, [setActionError, showForm]);

	useEffect(() => {
		const draft = readDraft<{
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
		}>(draftKey);
		if (!draft) {
			setDraftHydrated(true);
			return;
		}
		const { assigneeTouched: savedAssigneeTouched, ...formDraft } = draft;
		// Ältere Entwürfe ohne assigneeTouched speicherten den automatischen Vorschlag
		// (meist man selbst) mit; der allein soll das Formular nicht aufspringen lassen.
		if (
			typeof savedAssigneeTouched !== 'boolean' &&
			formDraft.assignedMemberId === identity.memberId
		) {
			formDraft.assignedMemberId = '';
		}
		if (!isEmptyModuleDraft('chore', formDraft, identity.memberId)) {
			assigneeTouchedRef.current =
				typeof savedAssigneeTouched === 'boolean' ? savedAssigneeTouched : true;
			// Ein gespeicherter Entwurf wird still wiederhergestellt und erscheint erst, wenn man
			// „Putzaufgabe hinzufügen“ tippt. Sonst sprang das Formular bei jedem Besuch von Haushalt
			// auf. Nur „Bearbeiten“ aus der Offline-Warteschlange öffnet es direkt (Nutzeraktion).
			if (formDraft.queueEditId) setShowForm(true);
		}
		if (draft.title) {
			setNewTitle(draft.title);
		}
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
	}, [
		draftKey,
		identity.memberId,
		setAbsenceEnd,
		setAbsenceMemberId,
		setAbsenceReason,
		setAbsenceStart,
	]);

	const applyChoreSuggestion = useCallback(
		(suggestion: ChoreSuggestion): void => {
			assigneeTouchedRef.current = false;
			writeDraft(draftKey, {
				title: suggestion.title,
				intervalDays: suggestion.intervalDays,
				recurrenceType: suggestion.recurrenceType,
				assignedMemberId: '',
			});
			setNewTitle(suggestion.title);
			setNewInterval(suggestion.intervalDays);
			setNewRecurrenceType(suggestion.recurrenceType);
			setNewAssigned('');
			setQueueEditId(null);
			setPendingSuggestion(null);
			setShowForm(true);
		},
		[draftKey],
	);

	const suggestChore = useCallback(
		(suggestion: ChoreSuggestion): void => {
			const draft = readDraft<Record<string, unknown>>(draftKey);
			if (draft && !isEmptyModuleDraft('chore', draft, identity.memberId)) {
				assigneeTouchedRef.current = true;
				setPendingSuggestion(suggestion);
				setShowForm(true);
			} else {
				applyChoreSuggestion(suggestion);
			}
		},
		[applyChoreSuggestion, draftKey, identity.memberId],
	);

	useEffect(() => {
		if (!prefillTitle || appliedPrefillRef.current === prefillTitle) return;
		appliedPrefillRef.current = prefillTitle;
		suggestChore({
			title: prefillTitle.slice(0, TITLE_MAX),
			intervalDays: 7,
			recurrenceType: 'days',
		});
	}, [prefillTitle, suggestChore]);

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
			// Nur eine selbst gewählte Zuständigkeit ist ein Entwurf. Der automatische Vorschlag
			// ließ das leere Formular sonst bei jedem Besuch wieder aufspringen.
			assignedMemberId: assigneeTouchedRef.current ? newAssigned : '',
			absenceMemberId,
			absenceStartDate: absenceStart,
			absenceEndDate: absenceEnd,
			absenceReason,
			queueEditId,
		};
		writeDraft(
			draftKey,
			isEmptyModuleDraft('chore', draft, identity.memberId)
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
		identity.memberId,
		newAssigned,
		newInterval,
		newRecurrenceType,
		newTitle,
		queueEditId,
	]);

	async function clearEditedQueueItem(expectedTypes?: OfflineActionType[]): Promise<boolean> {
		if (!queueEditId) return true;
		const saved = await updateOfflineQueue((actions) => {
			const queued = actions.find((item) => item.id === queueEditId);
			if (!queued || (expectedTypes && !expectedTypes.includes(queued.type))) return null;
			return actions.filter((item) => item.id !== queueEditId);
		});
		if (!saved) return false;
		setQueueEditId(null);
		return true;
	}

	/** The edited queue entry may have been synced meanwhile; a new create would duplicate it. */
	function editedQueueItemWasSent(type: OfflineActionType): boolean {
		if (!queueEditId) return false;
		const editType = readDraft<{ queueEditType?: string }>(draftKey)?.queueEditType;
		return editType === type && !isOfflineActionQueued(queueEditId);
	}

	async function add(): Promise<void> {
		const title = newTitle.trim();
		if (title.length === 0) return;
		const pendingKey = 'chore:add';
		if (isPending(pendingKey)) return;
		if (editedQueueItemWasSent('chore.create')) {
			setQueueEditId(null);
			setNewTitle('');
			setNewInterval(7);
			setNewRecurrenceType('days');
			setNewAssigned('');
			assigneeTouchedRef.current = false;
			setShowForm(false);
			removeDraft(draftKey);
			setActionError(null);
			setActionNotice(QUEUE_EDIT_ALREADY_SENT_MESSAGE);
			void load(false);
			return;
		}
		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);
		const fingerprint = JSON.stringify({
			title,
			intervalDays: newInterval,
			recurrenceType: newRecurrenceType,
			assignedMemberId: newAssigned || null,
		});
		const pendingRequest = choreCreateRequestRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setActionError('Aufgabe konnte nicht sicher gespeichert werden. Versuche es erneut.');
			endPending(pendingKey);
			return;
		}
		choreCreateRequestRef.current = { fingerprint, key: idempotencyKey };

		try {
			const result = await apiFetch<ChoreCreateResponse>(`/api/wg/${encodedShareCode}/chores`, {
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					title,
					intervalDays: newInterval,
					recurrenceType: newRecurrenceType,
					assignedMemberId: newAssigned || null,
				}),
			});

			if (!result.ok) {
				if (result.status > 0 && result.status < 500 && result.status !== 429)
					choreCreateRequestRef.current = null;
				if (result.status === 0) {
					const queued = createQueuedChore({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						title,
						intervalDays: newInterval,
						recurrenceType: newRecurrenceType,
						assignedMemberId: newAssigned || null,
					});
					if ((await enqueueOfflineAction(queued)) === 0) {
						setActionError(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
						return;
					}
					choreCreateRequestRef.current = null;
					refreshCount();
					const now = new Date();
					updateChores((current) => [
						{
							id: queued.id,
							title,
							intervalDays: newInterval,
							recurrenceType: newRecurrenceType,
							assignedMemberId: newAssigned || null,
							nextDueAt: computeNextDueAt(now, newInterval, now, newRecurrenceType).toISOString(),
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
						...current,
					]);
					setNewTitle('');
					setNewInterval(7);
					setNewRecurrenceType('days');
					setNewAssigned('');
					if (!(await clearEditedQueueItem(['chore.create']))) {
						setActionError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
						return;
					}
					assigneeTouchedRef.current = false;
					setShowForm(false);
					removeDraft(draftKey);
					setActionNotice(
						'Offline gespeichert. Wird synchronisiert, sobald ihr wieder online seid.',
					);
					return;
				}
				setActionError(choreCreateErrorMessage(result.error));
				return;
			}

			choreCreateRequestRef.current = null;
			setNewTitle('');
			setNewInterval(7);
			setNewRecurrenceType('days');
			setNewAssigned('');
			if (!(await clearEditedQueueItem(['chore.create']))) {
				setActionError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			assigneeTouchedRef.current = false;
			setShowForm(false);
			removeDraft(draftKey);
			void load(false);
			const warningMessage = notificationWarningMessage(result.data.warning);
			if (warningMessage) setActionNotice(warningMessage);
		} finally {
			endPending(pendingKey);
		}
	}

	// A restored choice (including nobody) survives close/keep. Only a fresh
	// form after saving, or an explicitly accepted suggestion, gets a default.
	useEffect(() => {
		if (!showForm || !draftHydrated || pendingSuggestion) return;
		if (assigneeTouchedRef.current || !suggestedAssignee || newAssigned) return;
		setNewAssigned(suggestedAssignee.id);
	}, [draftHydrated, suggestedAssignee, newAssigned, pendingSuggestion, showForm]);
	const handleAssignedMemberIdChange = (value: string): void => {
		assigneeTouchedRef.current = true;
		setNewAssigned(value);
	};

	function applyQuickChore(template: (typeof QUICK_CHORE_TEMPLATES)[number]): void {
		suggestChore(template);
		window.setTimeout(() => titleInputRef.current?.focus(), 0);
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
		showForm,
		setShowForm,
		pendingSuggestion,
		confirmSuggestion,
		setConfirmSuggestion,
		newTitle,
		setNewTitle,
		newInterval,
		newRecurrenceType,
		newAssigned,
		titleInputRef,
		applyChoreSuggestion,
		applyQuickChore,
		handleAssignedMemberIdChange,
		handleRecurrenceUnitToggle,
		handleIntervalPresetSelect,
		add,
		queueEdit: { setQueueEditId, clearEditedQueueItem, editedQueueItemWasSent } satisfies QueueEdit,
	};
}

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
import { useChoreDraftSync, useChoreFormFields } from './use-chore-draft';

export type ChoreSuggestion = {
	title: string;
	intervalDays: number;
	recurrenceType: RecurrenceType;
};
type ChoreCreateResponse = { chore: unknown; warning: NotificationWarning };

/** The offline queue entry the draft is currently editing. */
export interface QueueEdit {
	setQueueEditId: (id: string | null) => void;
	clearEditedQueueItem: (expectedTypes?: OfflineActionType[]) => Promise<boolean>;
	editedQueueItemWasSent: (type: OfflineActionType) => boolean;
}

/** Creating a chore: form, localStorage draft (with the absence fields), suggestions and saving. */
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
	const fields = useChoreFormFields();
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
		resetFields,
	} = fields;
	const [showForm, setShowForm] = useState(false);
	const [pendingSuggestion, setPendingSuggestion] = useState<ChoreSuggestion | null>(null);
	const [confirmSuggestion, setConfirmSuggestion] = useState(false);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'chore');
	const appliedPrefillRef = useRef<string | null>(null);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const choreCreateRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
	const draftHydrated = useChoreDraftSync({
		draftKey,
		memberId: identity.memberId,
		fields,
		absenceForm,
		queueEditId,
		setQueueEditId,
		setShowForm,
	});

	// An older error (completing, swapping …) does not belong in a freshly opened form.
	useEffect(() => {
		if (showForm) setActionError(null);
	}, [setActionError, showForm]);

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
		[
			assigneeTouchedRef,
			draftKey,
			setNewAssigned,
			setNewInterval,
			setNewRecurrenceType,
			setNewTitle,
		],
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
		[applyChoreSuggestion, assigneeTouchedRef, draftKey, identity.memberId],
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

	/** After a save (or a queue entry that was already sent): close the empty form, drop the draft. */
	function closeSavedForm(): void {
		assigneeTouchedRef.current = false;
		setShowForm(false);
		removeDraft(draftKey);
	}

	async function add(): Promise<void> {
		const title = newTitle.trim();
		if (title.length === 0) return;
		const pendingKey = 'chore:add';
		if (isPending(pendingKey)) return;
		if (editedQueueItemWasSent('chore.create')) {
			setQueueEditId(null);
			resetFields();
			closeSavedForm();
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
					resetFields();
					if (!(await clearEditedQueueItem(['chore.create']))) {
						setActionError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
						return;
					}
					closeSavedForm();
					setActionNotice(
						'Offline gespeichert. Wird synchronisiert, sobald ihr wieder online seid.',
					);
					return;
				}
				setActionError(choreCreateErrorMessage(result.error));
				return;
			}

			choreCreateRequestRef.current = null;
			resetFields();
			if (!(await clearEditedQueueItem(['chore.create']))) {
				setActionError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			closeSavedForm();
			void load(false);
			const warningMessage = notificationWarningMessage(result.data.warning);
			if (warningMessage) setActionNotice(warningMessage);
		} finally {
			endPending(pendingKey);
		}
	}

	// A restored choice (including nobody) survives close/keep. Only a fresh
	// form after saving, or an explicitly accepted suggestion, gets a default.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the touched flag is a ref read when the effect runs; setNewAssigned is stable.
	useEffect(() => {
		if (!showForm || !draftHydrated || pendingSuggestion) return;
		if (assigneeTouchedRef.current || !suggestedAssignee || newAssigned) return;
		setNewAssigned(suggestedAssignee.id);
	}, [draftHydrated, suggestedAssignee, newAssigned, pendingSuggestion, showForm]);

	function applyQuickChore(template: (typeof QUICK_CHORE_TEMPLATES)[number]): void {
		suggestChore(template);
		window.setTimeout(() => titleInputRef.current?.focus(), 0);
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
		handleAssignedMemberIdChange: fields.handleAssignedMemberIdChange,
		handleRecurrenceUnitToggle: fields.handleRecurrenceUnitToggle,
		handleIntervalPresetSelect: fields.handleIntervalPresetSelect,
		add,
		queueEdit: { setQueueEditId, clearEditedQueueItem, editedQueueItemWasSent } satisfies QueueEdit,
	};
}

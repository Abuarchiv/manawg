import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import type { NotificationWarning } from '@/core/notifications/notification-warning';
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
	removeQueuedAction,
} from '@/core/offline/offline-client';
import { createQueuedChore, type OfflineActionType } from '@/core/offline/offline-queue';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { dueAtForDay } from '@/features/chores/chore-due-date';
import { choreCreateErrorMessage } from '@/features/chores/chore-errors';
import type { ChoreFairness } from '@/features/chores/chore-fairness';
import { CHORE_TITLE_MAX } from '@/features/chores/chore-limits';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import type { RecurrenceType } from '@/features/chores/components/chore-types';
import { pendingKeys } from '@/features/chores/pending-keys';
import { useMessage } from '@/shared/i18n/message';
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
		toast,
		updateChores,
		load,
		refreshCount,
	} = ctx;
	const t = useTranslations('chores');
	const render = useMessage();
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
	// Optional day picked for the first due date; empty means "interval from today".
	// Not part of the draft: the shared draft key only knows the persisted fields.
	const [newFirstDue, setNewFirstDue] = useState('');
	const [pendingSuggestion, setPendingSuggestion] = useState<ChoreSuggestion | null>(null);
	const [confirmSuggestion, setConfirmSuggestion] = useState(false);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'chore');
	const appliedPrefillRef = useRef<string | null>(null);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const choreCreateRequestRef = useRef<PendingIdempotentRequest | null>(null);
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
			setNewFirstDue('');
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
		// The parameter is consumed; otherwise a reload triggers the same draft conflict again.
		const url = new URL(window.location.href);
		url.searchParams.delete('title');
		window.history.replaceState(window.history.state, '', url);
		suggestChore({
			title: prefillTitle.slice(0, CHORE_TITLE_MAX),
			intervalDays: 7,
			recurrenceType: 'days',
		});
	}, [prefillTitle, suggestChore]);

	async function clearEditedQueueItem(
		expectedTypes?: readonly OfflineActionType[],
	): Promise<boolean> {
		if (!queueEditId) return true;
		if (!(await removeQueuedAction(queueEditId, expectedTypes))) return false;
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
		const pendingKey = pendingKeys.CHORE_ADD;
		if (isPending(pendingKey)) return;
		if (editedQueueItemWasSent('chore.create')) {
			setQueueEditId(null);
			resetFields();
			closeSavedForm();
			setActionError(null);
			setActionNotice(t('offline.alreadySent'));
			void load(false);
			return;
		}
		let firstDueAt: string | undefined;
		if (newFirstDue) {
			const picked = dueAtForDay(newFirstDue);
			if (!picked || newFirstDue < berlinDayKey(new Date())) {
				setActionError(t('create.firstDueInPast'));
				return;
			}
			firstDueAt = picked;
		}
		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);
		const fingerprint = JSON.stringify({
			title,
			intervalDays: newInterval,
			recurrenceType: newRecurrenceType,
			assignedMemberId: newAssigned || null,
			nextDueAt: firstDueAt,
		});
		const idempotencyKey = resolveIdempotencyKey(choreCreateRequestRef.current, fingerprint);
		if (!idempotencyKey) {
			setActionError(t('create.keyUnavailable'));
			endPending(pendingKey);
			return;
		}
		choreCreateRequestRef.current = { fingerprint, key: idempotencyKey };

		try {
			const result = await apiFetch<ChoreCreateResponse>(`/api/wg/${encodedShareCode}/chores`, {
				method: 'POST',
				memberId: identity.memberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					title,
					intervalDays: newInterval,
					recurrenceType: newRecurrenceType,
					assignedMemberId: newAssigned || null,
					...(firstDueAt && { nextDueAt: firstDueAt }),
				}),
			});

			if (!result.ok) {
				if (shouldReleaseIdempotencyKey(result.status, result.error)) {
					choreCreateRequestRef.current = null;
				}
				if (result.status === 0) {
					// The replay posts the payload unchanged, so the due date is fixed here, at creation.
					const now = new Date();
					const nextDueAt =
						firstDueAt ?? computeNextDueAt(now, newInterval, now, newRecurrenceType).toISOString();
					const queued = createQueuedChore({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						title,
						intervalDays: newInterval,
						recurrenceType: newRecurrenceType,
						assignedMemberId: newAssigned || null,
						nextDueAt,
						...(!firstDueAt && { anchorAt: now.toISOString() }),
					});
					if ((await enqueueOfflineAction(queued)) === 0) {
						setActionError(t('offline.queueBlocked'));
						return;
					}
					choreCreateRequestRef.current = null;
					refreshCount();
					updateChores((current) => [
						{
							id: queued.id,
							title,
							intervalDays: newInterval,
							recurrenceType: newRecurrenceType,
							assignedMemberId: newAssigned || null,
							nextDueAt,
							lastCompletedAt: null,
							lastCompletedByName: null,
							openGapCountForAssignee: 0,
						},
						...current,
					]);
					resetFields();
					setNewFirstDue('');
					if (!(await clearEditedQueueItem(['chore.create']))) {
						setActionError(t('offline.draftCleanupFailed'));
						return;
					}
					closeSavedForm();
					setActionNotice(t('offline.saved'));
					return;
				}
				setActionError(render(choreCreateErrorMessage(result.error)));
				return;
			}

			choreCreateRequestRef.current = null;
			resetFields();
			setNewFirstDue('');
			if (!(await clearEditedQueueItem(['chore.create']))) {
				setActionError(t('offline.onlineDraftCleanupFailed'));
				return;
			}
			closeSavedForm();
			void load(false);
			const warning = result.data.warning;
			if (warning) {
				setActionNotice(
					t(
						warning === 'notification_delivery_failed'
							? 'create.deliveryFailed'
							: 'create.deliveryUnknown',
					),
				);
			} else toast.success(t('create.saved'));
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

	function applyQuickChore(template: ChoreSuggestion): void {
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
		newFirstDue,
		setNewFirstDue,
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

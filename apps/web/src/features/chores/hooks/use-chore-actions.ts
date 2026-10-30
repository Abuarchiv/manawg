import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiFetch } from '@/core/infra/api-client';
import { discardQueuedEntry } from '@/core/offline/offline-client';
import { isQueuedCreateId } from '@/core/offline/offline-queue';
import { parseValidDate } from '@/core/utils/time';
import { getAbsentMemberIds } from '@/features/chores/absence';
import { choreCompletionFeedback } from '@/features/chores/chore-completion';
import type { ChoreEditChanges } from '@/features/chores/chore-edit';
import { choreActionErrorMessage, choreEditErrorMessage } from '@/features/chores/chore-errors';
import { chooseNextAvailableMember } from '@/features/chores/chore-fairness';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import { getChoreStatus } from '@/features/chores/chore-status';
import type { Chore } from '@/features/chores/components/chore-types';
import { pendingKeys } from '@/features/chores/pending-keys';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, useMessage } from '@/shared/i18n/message';
import type { ChorePageContext } from './chore-page-context';
import { useChoreCompletion } from './use-chore-completion';

/** Completing (with a confirm tap), swap request, taking over and removing a chore. */
export function useChoreActions(ctx: ChorePageContext) {
	const {
		wg,
		identity,
		members,
		activeMembers,
		encodedShareCode,
		toast,
		isPending,
		startPending,
		endPending,
		setActionError,
		setActionNotice,
		items,
		absences,
		updateChores,
		load,
		refreshCount,
	} = ctx;
	const t = useTranslations('chores');
	const render = useMessage();
	const locale = useLocale() as Locale;
	const completeChore = useChoreCompletion(wg, identity);
	const [completeConfirmId, setCompleteConfirmId] = useState<string | null>(null);
	// Chores whose swap request is already on the noticeboard; a second tap would post a duplicate.
	const [swapRequestedIds, setSwapRequestedIds] = useState<ReadonlySet<string>>(new Set());

	/**
	 * A chore created offline only has a local pseudo id, which the server routes reject with
	 * `id_invalid`. A clear notice replaces the misleading error.
	 */
	function isStillQueued(chore: Chore): boolean {
		if (!isQueuedCreateId(chore.id)) return false;
		setActionError(null);
		setActionNotice(t('actions.stillQueued'));
		return true;
	}

	function restore(previousChore: Chore): void {
		updateChores((current) =>
			current.some((item) => item.id === previousChore.id)
				? current.map((item) => (item.id === previousChore.id ? previousChore : item))
				: [...current, previousChore],
		);
	}

	/** The chore stays in the plan offline: move it to its next date and assignee locally. */
	function advanceLocally(previousChore: Chore): void {
		const dueAt = parseValidDate(previousChore.nextDueAt);
		if (!dueAt) {
			// Without a valid date there is nothing to move; the row stays as it was.
			restore(previousChore);
			return;
		}
		const localNextDueAt = computeNextDueAt(
			dueAt,
			previousChore.intervalDays,
			new Date(),
			previousChore.recurrenceType,
		);
		const localNextAssignee = chooseNextAvailableMember({
			members: activeMembers,
			currentMemberId: previousChore.assignedMemberId,
			absentMemberIds: getAbsentMemberIds(absences, localNextDueAt.getTime()),
			chores: items,
		});
		updateChores((current) => [
			...current.filter((item) => item.id !== previousChore.id),
			{
				...previousChore,
				nextDueAt: localNextDueAt.toISOString(),
				assignedMemberId: localNextAssignee ?? previousChore.assignedMemberId,
			},
		]);
	}

	async function handleComplete(chore: Chore): Promise<void> {
		if (isPending(chore.id) || isStillQueued(chore)) return;

		// First tap → arm; second tap → commit
		if (completeConfirmId !== chore.id) {
			setActionError(null);
			setCompleteConfirmId(chore.id);
			return;
		}

		startPending(chore.id);
		setActionError(null);
		setActionNotice(null);
		const previousChore = items.find((item) => item.id === chore.id) ?? chore;
		updateChores((current) => current.filter((item) => item.id !== chore.id));

		const outcome = await completeChore(chore);
		switch (outcome.kind) {
			case 'completed':
				// Completing a chore closes the swap request; a new one is possible for the next occurrence.
				setSwapRequestedIds((current) => {
					if (!current.has(chore.id)) return current;
					const rest = new Set(current);
					rest.delete(chore.id);
					return rest;
				});
				if (outcome.next) {
					const next = outcome.next;
					const completed: Chore = {
						...chore,
						nextDueAt: next.nextDueAt,
						assignedMemberId: next.assignedMemberId,
						lastCompletedAt: new Date().toISOString(),
						lastCompletedByName: identity.name,
					};
					updateChores((current) =>
						current.some((item) => item.id === chore.id)
							? current.map((item) => (item.id === chore.id ? completed : item))
							: [...current, completed],
					);
				}
				break;
			case 'queued':
				advanceLocally(previousChore);
				refreshCount();
				break;
			case 'not_found':
				updateChores((current) => current.filter((item) => item.id !== chore.id));
				break;
			case 'already_completed':
			case 'occurrence_changed':
				break;
			default:
				restore(previousChore);
		}

		const feedback = choreCompletionFeedback(
			outcome,
			chore,
			(id) => {
				if (id === identity.memberId) return { name: identity.name, isSelf: true };
				const name = members.find((member) => member.id === id)?.name;
				return name === undefined ? undefined : { name, isSelf: false };
			},
			locale,
		);
		const message = render(feedback.message);
		if (feedback.tone === 'success') toast.success(message);
		else if (feedback.tone === 'notice') setActionNotice(message);
		else setActionError(message);
		// While the dialog stays open its alert already shows the error; a toast would duplicate it.
		const toastText = feedback.toast ? render(feedback.toast) : null;
		if (feedback.done && toastText && toastText !== message) toast.error(toastText);
		if (feedback.done) setCompleteConfirmId(null);
		if (feedback.reload) void load(false);
		endPending(chore.id);
	}

	/** Cancel also clears the error, which would otherwise linger as a page banner after the dialog closes. */
	function cancelComplete(): void {
		setActionError(null);
		setCompleteConfirmId(null);
	}

	async function handleSwapRequest(chore: Chore): Promise<void> {
		const pendingKey = pendingKeys.swap(chore.id);
		if (isPending(pendingKey) || swapRequestedIds.has(chore.id) || isStillQueued(chore)) return;

		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);

		const status = getChoreStatus(chore.nextDueAt);
		const result = await apiFetch<{ duplicate?: boolean }>(
			`/api/wg/${encodedShareCode}/announcements`,
			{
				method: 'POST',
				memberId: identity.memberId,
				body: JSON.stringify({
					kind: 'request',
					source: 'chore_swap',
					choreId: chore.id,
					// Parentheses instead of a linking verb: labels like "in 7 days" or "Check date" read wrong inside the sentence.
					content: t('actions.swapPost', {
						name: identity.name,
						title: chore.title,
						status: render(status.label),
					}),
				}),
			},
		);

		if (!result.ok) {
			setActionError(
				render(choreActionErrorMessage({ key: 'chores.errors.swapPostSubject' }, result)),
			);
		} else {
			setSwapRequestedIds((current) => new Set(current).add(chore.id));
			// The server answers with the existing post instead of creating a second one.
			toast.success(t(result.data.duplicate ? 'actions.swapDuplicate' : 'actions.swapPosted'));
		}

		endPending(pendingKey);
	}

	async function handleTakeOver(chore: Chore): Promise<void> {
		await patchChore(
			chore,
			{ assignedMemberId: identity.memberId },
			pendingKeys.take(chore.id),
			(result) => choreActionErrorMessage({ key: 'chores.errors.takeOverSubject' }, result),
			t('actions.takenOver'),
		);
	}

	/** Saves the edit form; resolves to whether it went through, so the drawer can close. */
	async function handleEdit(chore: Chore, changes: ChoreEditChanges): Promise<boolean> {
		const assigneeName =
			changes.assignedMemberId === undefined
				? null
				: changes.assignedMemberId === null
					? t('shared.nobody')
					: changes.assignedMemberId === identity.memberId
						? t('shared.you')
						: (members.find((member) => member.id === changes.assignedMemberId)?.name ?? null);
		return patchChore(
			chore,
			changes,
			pendingKeys.edit(chore.id),
			(result) => choreEditErrorMessage(result.error),
			assigneeName && Object.keys(changes).length === 1
				? t('actions.assignedNotice', { assignee: assigneeName })
				: t('actions.changesSaved'),
			chore.updatedAt,
		);
	}

	async function patchChore(
		chore: Chore,
		changes: ChoreEditChanges,
		pendingKey: string,
		errorMessage: (result: { error: string; status: number }) => Message,
		notice: string,
		expectedUpdatedAt?: string,
	): Promise<boolean> {
		if (isPending(pendingKey) || isStillQueued(chore)) return false;
		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);

		const result = await apiFetch<{ chore: Chore }>(
			`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(chore.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				body: JSON.stringify(expectedUpdatedAt ? { ...changes, expectedUpdatedAt } : changes),
			},
		);

		try {
			if (!result.ok) {
				if (result.status === 404 && result.error === 'chore_not_found') {
					updateChores((current) => current.filter((item) => item.id !== chore.id));
					setActionError(t('completion.notFound'));
					void load(false);
					return true;
				}
				setActionError(render(errorMessage(result)));
				if (result.status === 409 && result.error === 'chore_changed') void load(false);
				return false;
			}
			const savedVersion = result.data.chore.updatedAt
				? { updatedAt: result.data.chore.updatedAt }
				: {};
			updateChores((current) =>
				current.map((item) =>
					item.id === chore.id ? { ...item, ...changes, ...savedVersion } : item,
				),
			);
			// A new assignee settles the open swap request, so the chore can ask again later.
			if (changes.assignedMemberId !== undefined) {
				setSwapRequestedIds((current) => {
					if (!current.has(chore.id)) return current;
					const rest = new Set(current);
					rest.delete(chore.id);
					return rest;
				});
			}
			toast.success(notice);
			void load(false);
			return true;
		} finally {
			endPending(pendingKey);
		}
	}

	async function handleRemove(id: string): Promise<void> {
		if (isPending(id)) return;
		startPending(id);
		try {
			setActionError(null);
			setActionNotice(null);
			const queued = await discardQueuedEntry(wg.shareCode, id);
			if (queued === 'storage_blocked') {
				setActionError(t('actions.storageBlocked'));
				return;
			}
			if (queued === 'removed' || isQueuedCreateId(id)) {
				updateChores((current) => current.filter((item) => item.id !== id));
				refreshCount();
				setActionNotice(t('actions.queuedRemoved'));
				return;
			}

			const result = await apiFetch<Record<string, never>>(
				`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(id)}`,
				{
					method: 'DELETE',
					memberId: identity.memberId,
				},
			);

			if (!result.ok) {
				const msg =
					result.status === 403 && result.error === 'admin_required'
						? t('actions.adminRequired')
						: result.status === 404 && result.error === 'chore_not_found'
							? t('completion.notFound')
							: render(choreActionErrorMessage({ key: 'chores.errors.removeSubject' }, result));
				setActionError(msg);
				if (result.status === 404 && result.error === 'chore_not_found') {
					updateChores((current) => current.filter((item) => item.id !== id));
					void load(false);
				}
			} else {
				const removedTitle = items.find((item) => item.id === id)?.title;
				updateChores((current) => current.filter((item) => item.id !== id));
				toast.success(
					removedTitle ? t('actions.removedNamed', { title: removedTitle }) : t('actions.removed'),
				);
				void load(false);
			}
		} finally {
			endPending(id);
		}
	}

	return {
		completeConfirmId,
		cancelComplete,
		handleComplete,
		handleSwapRequest,
		swapRequestedIds,
		handleTakeOver,
		handleEdit,
		handleRemove,
	};
}

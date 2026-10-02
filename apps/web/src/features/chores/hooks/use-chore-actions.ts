import { isNetworkError } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { discardQueuedEntry, enqueueOfflineAction } from '@/core/offline/offline-client';
import {
	createOfflineIdempotencyKey,
	createQueuedChoreCompletion,
	isQueuedCreateId,
} from '@/core/offline/offline-queue';
import { formatShortDate, parseTimestamp } from '@/core/utils/time';
import { getAbsentMemberIds } from '@/features/chores/absence';
import { choreActionErrorMessage } from '@/features/chores/chore-errors';
import { chooseNextAvailableMember } from '@/features/chores/chore-fairness';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import { getChoreStatus } from '@/features/chores/chore-status';
import type { Chore } from '@/features/chores/components/chore-types';
import { useRef, useState } from 'react';
import type { ChorePageContext } from './chore-page-context';

/** Erledigen (mit Bestätigungs-Tap), Tauschanfrage, Übernehmen und Entfernen einer Aufgabe. */
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
		setItems,
		updateChores,
		load,
		refreshCount,
	} = ctx;
	const completionRequestKeysRef = useRef(new Map<string, string>());
	const [completeConfirmId, setCompleteConfirmId] = useState<string | null>(null);

	/**
	 * Eine offline angelegte Aufgabe hat nur eine lokale Pseudo-ID; die Server-Routen lehnen sie
	 * mit `id_invalid` ab. Statt einer irreführenden Fehlermeldung kommt ein klarer Hinweis.
	 */
	function isStillQueued(chore: Chore): boolean {
		if (!isQueuedCreateId(chore.id)) return false;
		setActionError(null);
		setActionNotice(
			'Diese Aufgabe ist noch offline vorgemerkt und lässt sich erst nach der Synchronisierung bearbeiten.',
		);
		return true;
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
		const idempotencyKey =
			completionRequestKeysRef.current.get(chore.id) ?? createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setActionError('Erledigt-Aktion konnte nicht sicher gespeichert werden. Versuche es erneut.');
			endPending(chore.id);
			return;
		}
		completionRequestKeysRef.current.set(chore.id, idempotencyKey);
		const previousChore = items.find((item) => item.id === chore.id) ?? chore;
		updateChores((current) => current.filter((item) => item.id !== chore.id));

		const result = await apiFetch<{ chore?: Pick<Chore, 'id' | 'nextDueAt' | 'assignedMemberId'> }>(
			`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(chore.id)}/complete`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					expectedNextDueAt: chore.nextDueAt,
					expectedAssignedMemberId: chore.assignedMemberId,
				}),
			},
		);

		if (!result.ok) {
			if (result.status > 0 && result.status < 500 && result.status !== 429)
				completionRequestKeysRef.current.delete(chore.id);
			if (result.status === 0) {
				const queuedCount = await enqueueOfflineAction(
					createQueuedChoreCompletion({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						choreId: chore.id,
						expectedNextDueAt: chore.nextDueAt,
						expectedAssignedMemberId: chore.assignedMemberId,
					}),
				);
				if (queuedCount === 0) {
					updateChores((current) =>
						current.some((item) => item.id === chore.id)
							? current.map((item) => (item.id === chore.id ? previousChore : item))
							: [...current, previousChore],
					);
					setActionError(
						'Offline-Speicher ist blockiert. Versuche es später erneut, sobald dein Browser wieder speichern kann.',
					);
					toast.error('Die Erledigung konnte nicht offline vorgemerkt werden.');
					endPending(chore.id);
					return;
				}
				// Aufgabe bleibt im Plan: lokal auf nächsten Termin/Zuständigen rücken,
				// der Server bestätigt beides nach der Synchronisierung.
				const localNextDueAt = computeNextDueAt(
					new Date(chore.nextDueAt),
					chore.intervalDays,
					new Date(),
					chore.recurrenceType,
				);
				const localNextAssignee = chooseNextAvailableMember({
					members: activeMembers,
					currentMemberId: chore.assignedMemberId,
					absentMemberIds: getAbsentMemberIds(absences, localNextDueAt.getTime()),
					chores: items,
				});
				updateChores((current) => [
					...current.filter((item) => item.id !== chore.id),
					{
						...previousChore,
						nextDueAt: localNextDueAt.toISOString(),
						assignedMemberId: localNextAssignee ?? previousChore.assignedMemberId,
					},
				]);
				completionRequestKeysRef.current.delete(chore.id);
				refreshCount();
				setActionNotice(
					'Erledigung offline vorgemerkt. Nächster Termin und Zuständigkeit werden nach der Synchronisierung bestätigt.',
				);
				setCompleteConfirmId(null);
				endPending(chore.id);
				return;
			}
			if (result.status === 404 && result.error === 'chore_not_found') {
				setItems((current) => current.filter((item) => item.id !== chore.id));
				setCompleteConfirmId(null);
				const message = 'Diese Putzaufgabe existiert nicht mehr und wurde aus dem Plan entfernt.';
				setActionError(message);
				toast.error(message);
				void load(false);
				endPending(chore.id);
				return;
			}
			if (
				(result.status === 404 || result.status === 409) &&
				result.error === 'chore_already_completed'
			) {
				setCompleteConfirmId(null);
				setActionNotice('Diese Putzaufgabe wurde bereits erledigt. Der Plan wird aktualisiert.');
				void load(false);
				endPending(chore.id);
				return;
			}
			if (result.status === 409 && result.error === 'chore_occurrence_changed') {
				setCompleteConfirmId(null);
				setActionError(
					'Termin oder Zuständigkeit haben sich geändert. Prüfe den aktualisierten Plan.',
				);
				void load(false);
				endPending(chore.id);
				return;
			}
			if (result.error === 'completion_insert_failed') {
				updateChores((current) =>
					current.some((item) => item.id === chore.id)
						? current.map((item) => (item.id === chore.id ? previousChore : item))
						: [...current, previousChore],
				);
				const message =
					'Erledigt-Aktion konnte nicht vollständig gespeichert werden: Lade den Plan neu und prüfe den Verlauf.';
				setActionError(message);
				toast.error(message);
				void load(false);
				endPending(chore.id);
				return;
			}
			updateChores((current) =>
				current.some((item) => item.id === chore.id)
					? current.map((item) => (item.id === chore.id ? previousChore : item))
					: [...current, previousChore],
			);
			const message = 'Erledigt-Aktion konnte nicht gespeichert werden: Versuche es gleich erneut.';
			setActionError(message);
			toast.error(message);
		} else {
			completionRequestKeysRef.current.delete(chore.id);
			const updated = result.data.chore;
			const confirmed = updated?.id === chore.id && parseTimestamp(updated.nextDueAt) !== null;
			if (confirmed) {
				updateChores((current) => {
					const completed: Chore = {
						...chore,
						nextDueAt: updated.nextDueAt,
						assignedMemberId: updated.assignedMemberId,
						lastCompletedAt: new Date().toISOString(),
						lastCompletedByName: identity.name,
					};
					return current.some((item) => item.id === chore.id)
						? current.map((item) => (item.id === chore.id ? completed : item))
						: [...current, completed];
				});
				const nextName = members.find((member) => member.id === updated.assignedMemberId)?.name;
				setActionNotice(
					`Erledigt. Nächster Termin: ${formatShortDate(updated.nextDueAt, 'Europe/Berlin')}; ${nextName ? `${nextName} ist dran (Rotation).` : 'noch niemand zugewiesen.'}`,
				);
			} else {
				setActionNotice(
					'Erledigt. Der bestätigte nächste Termin und die Zuständigkeit werden geladen.',
				);
			}

			setCompleteConfirmId(null);
			toast.success('Aufgabe erledigt.');
			void load(false);
		}

		endPending(chore.id);
	}

	async function handleSwapRequest(chore: Chore): Promise<void> {
		const pendingKey = `${chore.id}:swap`;
		if (isPending(pendingKey) || isStillQueued(chore)) return;

		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);

		const status = getChoreStatus(chore.nextDueAt);
		const result = await apiFetch<Record<string, never>>(
			`/api/wg/${encodedShareCode}/announcements`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({
					kind: 'request',
					source: 'chore_swap',
					choreId: chore.id,
					// Klammer statt „ist …“: Labels wie „in 7 T.“ oder „Datum prüfen“ ergeben im Satz „T..“ bzw. Unsinn.
					content: `${identity.name} bittet um Tausch: „${chore.title}“ (${status.label}). Übernehmen oder kurz absprechen?`,
				}),
			},
		);

		if (!result.ok) {
			setActionError(choreActionErrorMessage('Tauschanfrage konnte nicht gepostet werden', result));
		} else {
			setActionNotice('Tauschanfrage wurde auf der Pinnwand gepostet.');
		}

		endPending(pendingKey);
	}

	async function handleTakeOver(chore: Chore): Promise<void> {
		await handleAssignTo(chore, identity.memberId, 'Du bist jetzt für die Aufgabe eingetragen.');
	}

	async function handleAssignTo(chore: Chore, memberId: string, notice: string): Promise<void> {
		const pendingKey = `${chore.id}:take`;
		if (isPending(pendingKey) || isStillQueued(chore)) return;
		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);

		const result = await apiFetch<{ chore: Chore }>(
			`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(chore.id)}`,
			{
				method: 'PATCH',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({ assignedMemberId: memberId }),
			},
		);

		if (!result.ok) {
			if (result.status === 404 && result.error === 'chore_not_found') {
				setItems((current) => current.filter((item) => item.id !== chore.id));
				setActionError('Diese Putzaufgabe existiert nicht mehr und wurde aus dem Plan entfernt.');
				void load(false);
				endPending(pendingKey);
				return;
			}
			setActionError(choreActionErrorMessage('Aufgabe konnte nicht übernommen werden', result));
		} else {
			setItems((current) =>
				current.map((item) =>
					item.id === chore.id ? { ...item, assignedMemberId: memberId } : item,
				),
			);
			setActionNotice(notice);
			void load(false);
		}

		endPending(pendingKey);
	}

	async function handleRemove(id: string): Promise<void> {
		if (isPending(id)) return;
		startPending(id);
		try {
			setActionError(null);
			setActionNotice(null);
			const queued = await discardQueuedEntry(wg.shareCode, id);
			if (queued === 'storage_blocked') {
				setActionError(
					'Offline-Speicher ist blockiert. Die vorgemerkte Aufgabe konnte nicht entfernt werden.',
				);
				return;
			}
			if (queued === 'removed' || isQueuedCreateId(id)) {
				setItems((current) => current.filter((item) => item.id !== id));
				refreshCount();
				setActionNotice('Offline vorgemerkte Aufgabe wurde entfernt.');
				return;
			}

			const result = await apiFetch<Record<string, never>>(
				`/api/wg/${encodedShareCode}/chores/${encodeURIComponent(id)}`,
				{
					method: 'DELETE',
					memberId: identity.memberId,
					memberToken: identity.memberToken,
				},
			);

			if (!result.ok) {
				const msg =
					result.status === 403
						? 'Nur WG-Admins können diese Aufgabe endgültig entfernen.'
						: result.status === 404 && result.error === 'chore_not_found'
							? 'Diese Putzaufgabe existiert nicht mehr und wurde aus dem Plan entfernt.'
							: isNetworkError(result.error, result.status)
								? 'Entfernen fehlgeschlagen: Prüfe deine Verbindung und versuche es erneut.'
								: 'Entfernen fehlgeschlagen. Versuche es gleich erneut.';
				setActionError(msg);
				if (result.status === 404 && result.error === 'chore_not_found') {
					setItems((current) => current.filter((item) => item.id !== id));
					void load(false);
				}
			} else {
				setItems((current) => current.filter((item) => item.id !== id));
				void load(false);
			}
		} finally {
			endPending(id);
		}
	}

	return {
		completeConfirmId,
		setCompleteConfirmId,
		handleComplete,
		handleSwapRequest,
		handleTakeOver,
		handleRemove,
	};
}

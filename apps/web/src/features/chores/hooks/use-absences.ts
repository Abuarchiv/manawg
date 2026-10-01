import { isNetworkError } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { discardQueuedEntry, enqueueOfflineAction } from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
	QUEUE_EDIT_ALREADY_SENT_MESSAGE,
} from '@/core/offline/offline-copy';
import {
	createOfflineIdempotencyKey,
	createQueuedAbsence,
	isQueuedCreateId,
} from '@/core/offline/offline-queue';
import { endOfBerlinDay, instantAtBerlinWallTime } from '@/core/utils/berlin-day';
import type { AbsenceInput } from '@/features/chores/absence';
import { absenceSaveErrorMessage } from '@/features/chores/chore-errors';
import { useRef, useState } from 'react';
import type { ChorePageContext } from './chore-page-context';
import type { QueueEdit } from './use-chore-create';

/** Formularfelder der Abwesenheit; sie liegen im selben Entwurf wie die Aufgabe. */
export function useAbsenceFormState(initialMemberId: string) {
	const [absenceMemberId, setAbsenceMemberId] = useState(initialMemberId);
	const [absenceStart, setAbsenceStart] = useState('');
	const [absenceEnd, setAbsenceEnd] = useState('');
	const [absenceReason, setAbsenceReason] = useState('');
	return {
		absenceMemberId,
		setAbsenceMemberId,
		absenceStart,
		setAbsenceStart,
		absenceEnd,
		setAbsenceEnd,
		absenceReason,
		setAbsenceReason,
	};
}
export type AbsenceFormState = ReturnType<typeof useAbsenceFormState>;

export function useAbsences(ctx: ChorePageContext, form: AbsenceFormState, queueEdit: QueueEdit) {
	const {
		wg,
		identity,
		members,
		encodedShareCode,
		isPending,
		startPending,
		endPending,
		setActionError,
		setActionNotice,
		updateAbsences,
		refreshCount,
		load,
	} = ctx;
	const { absenceMemberId, absenceStart, absenceEnd, absenceReason } = form;
	const { setAbsenceStart, setAbsenceEnd, setAbsenceReason } = form;
	const { setQueueEditId, clearEditedQueueItem, editedQueueItemWasSent } = queueEdit;
	const absenceCreateRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

	async function addAbsence(): Promise<void> {
		if (!absenceStart || !absenceEnd) return;
		const startDay = /^\d{4}-\d{2}-\d{2}$/.test(absenceStart)
			? instantAtBerlinWallTime(absenceStart, 0)
			: null;
		const endDay = /^\d{4}-\d{2}-\d{2}$/.test(absenceEnd)
			? instantAtBerlinWallTime(absenceEnd, 0)
			: null;
		if (!startDay || !endDay || startDay > endDay) {
			setActionError('Bitte wähle einen gültigen Zeitraum für die Abwesenheit.');
			return;
		}
		// Die Liste zeigt nur laufende und künftige Abwesenheiten; eine vergangene würde
		// scheinbar gespeichert und sofort wieder aus der Ansicht verschwinden.
		if (endOfBerlinDay(endDay) < new Date()) {
			setActionError('Das Ende der Abwesenheit liegt in der Vergangenheit.');
			return;
		}
		const pendingKey = 'absence:add';
		if (isPending(pendingKey)) return;
		if (editedQueueItemWasSent('absence.create')) {
			setQueueEditId(null);
			setAbsenceStart('');
			setAbsenceEnd('');
			setAbsenceReason('');
			setActionError(null);
			setActionNotice(QUEUE_EDIT_ALREADY_SENT_MESSAGE);
			void load(false);
			return;
		}
		startPending(pendingKey);
		setActionError(null);
		setActionNotice(null);
		const startDate = startDay.toISOString();
		const endDate = endOfBerlinDay(endDay).toISOString();
		const fingerprint = JSON.stringify({
			memberId: absenceMemberId,
			startDate,
			endDate,
			reason: absenceReason.trim() || null,
		});
		const pendingRequest = absenceCreateRequestRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setActionError('Abwesenheit konnte nicht sicher gespeichert werden. Versuche es erneut.');
			endPending(pendingKey);
			return;
		}
		absenceCreateRequestRef.current = { fingerprint, key: idempotencyKey };
		try {
			const result = await apiFetch<{ absence: AbsenceInput | null }>(
				`/api/wg/${encodedShareCode}/absences`,
				{
					method: 'POST',
					memberId: identity.memberId,
					memberToken: identity.memberToken,
					headers: { 'Idempotency-Key': idempotencyKey },
					body: JSON.stringify({
						memberId: absenceMemberId,
						startDate,
						endDate,
						reason: absenceReason.trim() || null,
					}),
				},
			);
			if (!result.ok) {
				if (result.status > 0 && result.status < 500 && result.status !== 429)
					absenceCreateRequestRef.current = null;
				if (result.status === 0) {
					const queued = createQueuedAbsence({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						absenceMemberId,
						startDate,
						endDate,
						reason: absenceReason.trim() || null,
					});
					if ((await enqueueOfflineAction(queued)) === 0) {
						setActionError(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
						return;
					}
					absenceCreateRequestRef.current = null;
					if (!(await clearEditedQueueItem(['absence.create']))) {
						setActionError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
						return;
					}
					refreshCount();
					updateAbsences((current) => [
						{
							id: queued.id,
							memberId: absenceMemberId,
							memberName: members.find((member) => member.id === absenceMemberId)?.name ?? '?',
							startDate,
							endDate,
							reason: absenceReason.trim() || null,
						},
						...current,
					]);
					setAbsenceStart('');
					setAbsenceEnd('');
					setAbsenceReason('');
					setQueueEditId(null);
					setActionNotice(
						'Offline gespeichert. Die Rotation nutzt diese Abwesenheit sofort lokal.',
					);
					return;
				}
				setActionError(absenceSaveErrorMessage(result.error));
				return;
			}
			absenceCreateRequestRef.current = null;
			setAbsenceStart('');
			setAbsenceEnd('');
			setAbsenceReason('');
			if (!(await clearEditedQueueItem(['absence.create']))) {
				setActionError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			setQueueEditId(null);
			setActionNotice('Abwesenheit gespeichert. Die Rotation überspringt diese Person.');
			void load(false);
		} finally {
			endPending(pendingKey);
		}
	}

	async function removeAbsence(id: string): Promise<void> {
		const pendingKey = `absence:${id}:remove`;
		if (isPending(pendingKey)) return;
		startPending(pendingKey);
		try {
			const queued = await discardQueuedEntry(wg.shareCode, id);
			if (queued === 'storage_blocked') {
				setActionError(
					'Offline-Speicher ist blockiert. Die vorgemerkte Abwesenheit konnte nicht entfernt werden.',
				);
				return;
			}
			if (queued === 'removed' || isQueuedCreateId(id)) {
				updateAbsences((current) => current.filter((absence) => absence.id !== id));
				refreshCount();
				setActionError(null);
				setActionNotice('Offline vorgemerkte Abwesenheit wurde entfernt.');
				return;
			}
			const result = await apiFetch<Record<string, never>>(
				`/api/wg/${encodedShareCode}/absences/${encodeURIComponent(id)}`,
				{
					method: 'DELETE',
					memberId: identity.memberId,
					memberToken: identity.memberToken,
				},
			);
			if (!result.ok) {
				if (result.status === 404 && result.error === 'absence_not_found') {
					updateAbsences((current) => current.filter((absence) => absence.id !== id));
					setActionError('Diese Abwesenheit existiert nicht mehr und wurde aus dem Plan entfernt.');
					void load(false);
					return;
				}
				setActionError(
					isNetworkError(result.error, result.status)
						? 'Abwesenheit konnte nicht entfernt werden: Prüfe deine Verbindung und versuche es erneut.'
						: 'Abwesenheit konnte nicht entfernt werden.',
				);
				return;
			}
			updateAbsences((current) => current.filter((absence) => absence.id !== id));
		} finally {
			endPending(pendingKey);
		}
	}

	return { addAbsence, removeAbsence };
}

import { isNetworkError } from '@/core/http/error-codes';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { discardQueuedEntry, enqueueOfflineAction } from '@/core/offline/offline-client';

import { createQueuedAbsence, isQueuedCreateId } from '@/core/offline/offline-queue';
import { endOfBerlinDay, instantAtBerlinWallTime } from '@/core/utils/berlin-day';
import type { AbsenceInput } from '@/features/chores/absence';
import { absenceSaveErrorMessage } from '@/features/chores/chore-errors';
import { pendingKeys } from '@/features/chores/pending-keys';
import { useMessage } from '@/shared/i18n/message';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import type { ChorePageContext } from './chore-page-context';
import type { QueueEdit } from './use-chore-create';

/** Absence form fields; they live in the same draft as the chore. */
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
		toast,
		absences,
		setActionNotice,
		updateAbsences,
		refreshCount,
		load,
	} = ctx;
	const { absenceMemberId, absenceStart, absenceEnd, absenceReason } = form;
	const { setAbsenceStart, setAbsenceEnd, setAbsenceReason } = form;
	const { setQueueEditId, clearEditedQueueItem, editedQueueItemWasSent } = queueEdit;
	const t = useTranslations('chores');
	const render = useMessage();
	const [absenceError, setAbsenceError] = useState<string | null>(null);
	const [absenceListError, setAbsenceListError] = useState<string | null>(null);
	const absenceCreateRequestRef = useRef<PendingIdempotentRequest | null>(null);

	async function addAbsence(): Promise<void> {
		if (!absenceStart || !absenceEnd) return;
		const startDay = /^\d{4}-\d{2}-\d{2}$/.test(absenceStart)
			? instantAtBerlinWallTime(absenceStart, 0)
			: null;
		const endDay = /^\d{4}-\d{2}-\d{2}$/.test(absenceEnd)
			? instantAtBerlinWallTime(absenceEnd, 0)
			: null;
		if (!startDay || !endDay || startDay > endDay) {
			setAbsenceError(t('absence.invalidRange'));
			return;
		}
		// The list shows only current and future absences; a past one would seem
		// saved and immediately vanish from view.
		if (endOfBerlinDay(endDay) < new Date()) {
			setAbsenceError(t('absence.endInPast'));
			return;
		}
		const pendingKey = pendingKeys.ABSENCE_ADD;
		if (isPending(pendingKey)) return;
		if (editedQueueItemWasSent('absence.create')) {
			setQueueEditId(null);
			setAbsenceStart('');
			setAbsenceEnd('');
			setAbsenceReason('');
			setAbsenceError(null);
			setActionNotice(t('offline.alreadySent'));
			void load(false);
			return;
		}
		startPending(pendingKey);
		setAbsenceError(null);
		setActionNotice(null);
		const startDate = startDay.toISOString();
		const endDate = endOfBerlinDay(endDay).toISOString();
		const fingerprint = JSON.stringify({
			memberId: absenceMemberId,
			startDate,
			endDate,
			reason: absenceReason.trim() || null,
		});
		const idempotencyKey = resolveIdempotencyKey(absenceCreateRequestRef.current, fingerprint);
		if (!idempotencyKey) {
			setAbsenceError(t('absence.keyUnavailable'));
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
				if (shouldReleaseIdempotencyKey(result.status, result.error)) {
					absenceCreateRequestRef.current = null;
				}
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
						setAbsenceError(t('offline.queueBlocked'));
						return;
					}
					absenceCreateRequestRef.current = null;
					if (!(await clearEditedQueueItem(['absence.create']))) {
						setAbsenceError(t('offline.draftCleanupFailed'));
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
					toast.success(t('absence.savedOffline'));
					return;
				}
				setAbsenceError(render(absenceSaveErrorMessage(result.error)));
				return;
			}
			absenceCreateRequestRef.current = null;
			setAbsenceStart('');
			setAbsenceEnd('');
			setAbsenceReason('');
			if (!(await clearEditedQueueItem(['absence.create']))) {
				setAbsenceError(t('offline.onlineDraftCleanupFailed'));
				return;
			}
			setQueueEditId(null);
			toast.success(t('absence.saved'));
			void load(false);
		} finally {
			endPending(pendingKey);
		}
	}

	async function removeAbsence(id: string): Promise<void> {
		const pendingKey = pendingKeys.absenceRemove(id);
		if (isPending(pendingKey)) return;
		startPending(pendingKey);
		setAbsenceListError(null);
		try {
			const queued = await discardQueuedEntry(wg.shareCode, id);
			if (queued === 'storage_blocked') {
				setAbsenceListError(t('absence.storageBlocked'));
				return;
			}
			if (queued === 'removed' || isQueuedCreateId(id)) {
				updateAbsences((current) => current.filter((absence) => absence.id !== id));
				refreshCount();
				setAbsenceListError(null);
				setActionNotice(t('absence.queuedRemoved'));
				return;
			}
			const result = await apiFetch<Record<string, never>>(
				`/api/wg/${encodedShareCode}/absences/${encodeURIComponent(id)}`,
				{
					method: 'DELETE',
					memberId: identity.memberId,
				},
			);
			if (!result.ok) {
				if (result.status === 404 && result.error === 'absence_not_found') {
					updateAbsences((current) => current.filter((absence) => absence.id !== id));
					setAbsenceListError(t('absence.gone'));
					void load(false);
					return;
				}
				setAbsenceListError(
					t(
						isNetworkError(result.error, result.status)
							? 'absence.removeNetwork'
							: 'absence.removeFailed',
					),
				);
				return;
			}
			const removed = absences.find((absence) => absence.id === id);
			updateAbsences((current) => current.filter((absence) => absence.id !== id));
			toast.success(
				removed ? t('absence.removedNamed', { name: removed.memberName }) : t('absence.removed'),
			);
		} finally {
			endPending(pendingKey);
		}
	}

	return {
		addAbsence,
		removeAbsence,
		absenceError,
		absenceListError,
		clearAbsenceError: () => setAbsenceError(null),
	};
}

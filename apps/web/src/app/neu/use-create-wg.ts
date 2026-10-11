'use client';

import { REQUEST_TIMEOUT_MS } from '@/core/infra/api-client';
import { removeDraft } from '@/core/offline/drafts';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import posthog from '@/shared/lib/analytics';
import { useRef, useState } from 'react';
import {
	type CreateResponse,
	type CreatedWg,
	START_DRAFT_KEY,
	type StartStep,
	createWgErrorField,
	createWgErrorMessage,
	readStartError,
} from './start-flow';
import type { BusyLock } from './use-busy-lock';
import type { StartErrorActions } from './use-start-error';

/**
 * Creates the WG. The idempotency key is reused while the same name pair is
 * retried, so a retry after a network failure cannot create a second WG.
 */
export function useCreateWg({
	wgName,
	creatorName,
	setStep,
	busyRef,
	setBusy,
	clearError,
	setFormError,
	setFieldError,
	returnToSignIn,
}: BusyLock &
	StartErrorActions & {
		wgName: string;
		creatorName: string;
		setStep: (step: StartStep) => void;
		returnToSignIn: () => void;
	}) {
	const [createdWg, setCreatedWg] = useState<CreatedWg | null>(null);
	const createRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

	async function createWg(): Promise<void> {
		if (busyRef.current) return;
		const trimmedWg = wgName.trim();
		const trimmedMe = creatorName.trim();
		if (trimmedWg.length === 0) return setFieldError('wgName', 'WG-Name fehlt.');
		if (trimmedMe.length === 0) return setFieldError('creatorName', 'Dein Anzeigename fehlt.');
		busyRef.current = true;
		setBusy(true);
		clearError();
		const body = { name: trimmedWg, creatorName: trimmedMe };
		const fingerprint = JSON.stringify(body);
		const pendingRequest = createRequestRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setFormError('WG konnte nicht sicher erstellt werden. Versuche es erneut.');
			busyRef.current = false;
			setBusy(false);
			return;
		}
		createRequestRef.current = { fingerprint, key: idempotencyKey };
		try {
			const res = await fetch('/api/wg', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (res.status === 401) {
				returnToSignIn();
				return;
			}
			if (!res.ok) {
				if (res.status > 0 && res.status < 500) createRequestRef.current = null;
				const apiError = await readStartError(res);
				const message = createWgErrorMessage(res.status, apiError);
				const field = createWgErrorField(res.status, apiError);
				if (field) setFieldError(field, message);
				else setFormError(message);
				return;
			}
			const data = (await res.json()) as CreateResponse;
			// Only now is the created WG known; a body lost in transit must be retried
			// with the same key, or the retry would create a second WG.
			createRequestRef.current = null;
			posthog.capture('wg_created');
			removeDraft(START_DRAFT_KEY);
			setCreatedWg({ code: data.wg.shareCode, name: data.wg.name });
			setStep('invite');
		} catch {
			setFormError(
				'WG konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.',
			);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	return { createdWg, setCreatedWg, createWg };
}

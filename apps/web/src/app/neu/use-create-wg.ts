'use client';

import { useRef, useState } from 'react';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { REQUEST_TIMEOUT_MS, readApiErrorCode } from '@/core/infra/api-client';
import { removeDraft } from '@/core/offline/drafts';
import { useMessage } from '@/shared/i18n/message';
import posthog from '@/shared/lib/analytics';
import {
	type CreatedWg,
	type CreateResponse,
	createWgErrorField,
	createWgErrorMessage,
	START_DRAFT_KEY,
	type StartStep,
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
	const render = useMessage();
	const [createdWg, setCreatedWg] = useState<CreatedWg | null>(null);
	const createRequestRef = useRef<PendingIdempotentRequest | null>(null);

	async function createWg(): Promise<void> {
		if (busyRef.current) return;
		const trimmedWg = wgName.trim();
		const trimmedMe = creatorName.trim();
		if (trimmedWg.length === 0) {
			return setFieldError('wgName', render({ key: 'entry.errors.wgNameMissing' }));
		}
		if (trimmedMe.length === 0) {
			return setFieldError('creatorName', render({ key: 'entry.errors.displayNameMissing' }));
		}
		busyRef.current = true;
		setBusy(true);
		clearError();
		const body = { name: trimmedWg, creatorName: trimmedMe };
		const fingerprint = JSON.stringify(body);
		const idempotencyKey = resolveIdempotencyKey(createRequestRef.current, fingerprint);
		if (!idempotencyKey) {
			setFormError(render({ key: 'entry.errors.createKeyUnavailable' }));
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
				const apiError = await readApiErrorCode(res);
				if (shouldReleaseIdempotencyKey(res.status, apiError)) createRequestRef.current = null;
				const message = render(createWgErrorMessage(res.status, apiError));
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
			setCreatedWg({ code: data.wg.shareCode, name: data.wg.name, memberId: data.creator.id });
			setStep('invite');
		} catch {
			setFormError(render({ key: 'entry.errors.createOffline' }));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	return { createdWg, setCreatedWg, createWg };
}

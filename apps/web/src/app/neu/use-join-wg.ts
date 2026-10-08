'use client';

import { REQUEST_TIMEOUT_MS } from '@/core/infra/api-client';
import { joinErrorMessage } from '@/core/infra/join-flow';
import { removeDraft } from '@/core/offline/drafts';
import { createOfflineIdempotencyKey } from '@/core/offline/offline-queue';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
import posthog from '@/shared/lib/analytics';
import { rememberWg } from '@/core/auth/identity';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import {
	type JoinWg,
	START_DRAFT_KEY,
	type StartStep,
	joinErrorField,
	readStartError,
} from './start-flow';
import type { BusyLock } from './use-busy-lock';
import type { StartErrorActions } from './use-start-error';

/**
 * Joining by code: a local code check moves on to the name step, the POST
 * with the name joins. The idempotency key is reused while the same code and
 * name are retried.
 */
export function useJoinWg({
	joinCode,
	joinName,
	joinWg,
	setJoinWg,
	setStep,
	busyRef,
	setBusy,
	clearError,
	setFormError,
	setFieldError,
	returnToSignIn,
	sessionless,
}: BusyLock &
	StartErrorActions & {
		joinCode: string;
		joinName: string;
		joinWg: JoinWg | null;
		setJoinWg: (joinWg: JoinWg | null) => void;
		setStep: (step: StartStep) => void;
		returnToSignIn: () => void;
		/** Database-free test build without a Supabase session. */
		sessionless: boolean;
	}) {
	const router = useRouter();
	const joinRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

	async function verifyJoinCode(): Promise<void> {
		if (busyRef.current) return;
		const code = normalizeShareCode(joinCode);
		if (!isValidShareCode(code)) {
			setFieldError(
				'joinCode',
				'Code besteht aus 8 Zeichen (Großbuchstaben/Ziffern, ohne I/L/O/U).',
			);
			return;
		}
		busyRef.current = true;
		setBusy(true);
		clearError();
		try {
			if (sessionless) {
				// The database-free build keeps its policy-preview contract; a real
				// build never performs this private metadata lookup before joining.
				const res = await fetch(`/api/wg/${encodeURIComponent(code)}`, { cache: 'no-store' });
				if (!res.ok) {
					const apiError = await readStartError(res);
					const message = joinErrorMessage(res.status, apiError);
					const field = joinErrorField(res.status, apiError);
					if (field) setFieldError(field, message);
					else setFormError(message);
					return;
				}
				const data = (await res.json()) as {
					wg: { id: string; shareCode: string; name: string; joiningEnabled?: boolean };
				};
				if (data.wg.joiningEnabled === false) {
					setFormError(joinErrorMessage(403, 'joining_disabled'));
					return;
				}
			}
			// A valid code is only a local input checkpoint. The authenticated POST
			// remains the authority for existence, membership, and invite policy.
			// The real WG name isn't fetchable pre-join (GET /api/wg/[code] requires
			// membership), so we show the code itself rather than a fabricated name.
			setJoinWg({ code, name: `WG ${code}` });
			setStep('joinName');
		} catch {
			setFormError(joinErrorMessage(0, ''));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	async function joinExistingWg(): Promise<void> {
		if (busyRef.current) return;
		const name = joinName.trim();
		if (!joinWg) return;
		if (name.length === 0) {
			setFieldError('joinName', 'Dein Anzeigename fehlt.');
			return;
		}
		busyRef.current = true;
		setBusy(true);
		clearError();
		const body = { name };
		const fingerprint = JSON.stringify({ code: joinWg.code, ...body });
		const pendingRequest = joinRequestRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setFormError('WG-Beitritt konnte nicht sicher gesendet werden. Versuche es erneut.');
			busyRef.current = false;
			setBusy(false);
			return;
		}
		joinRequestRef.current = { fingerprint, key: idempotencyKey };
		try {
			const res = await fetch(`/api/wg/${encodeURIComponent(joinWg.code)}/members`, {
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
				if (res.status > 0 && res.status < 500) joinRequestRef.current = null;
				const apiError = await readStartError(res);
				if (res.status === 409 && apiError === 'already_joined') {
					removeDraft(START_DRAFT_KEY);
					router.push(`/wg/${encodeURIComponent(joinWg.code)}`);
					return;
				}
				const message =
					apiError === 'auth_required'
						? 'Melde dich zuerst mit deinem Konto an.'
						: joinErrorMessage(res.status, apiError);
				if (apiError === 'name_invalid' || (res.status === 409 && apiError === 'name_taken')) {
					setFieldError('joinName', message);
				} else if (joinErrorField(res.status, apiError) === 'joinCode') {
					// The code is only checked by this POST; send the user back to fix it.
					setStep('join');
					setFieldError('joinCode', message);
				} else {
					setFormError(message);
				}
				return;
			}
			await res.json();
			joinRequestRef.current = null;
			posthog.capture('wg_joined');
			rememberWg({ code: joinWg.code, name: joinWg.name, lastVisitedAt: Date.now() });
			removeDraft(START_DRAFT_KEY);
			router.push(`/wg/${encodeURIComponent(joinWg.code)}`);
		} catch {
			setFormError(joinErrorMessage(0, ''));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	return { verifyJoinCode, joinExistingWg };
}

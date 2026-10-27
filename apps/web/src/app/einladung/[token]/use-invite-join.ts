'use client';

import { hasSessionCookie } from '@/core/auth/session-hint';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { REQUEST_TIMEOUT_MS, anySignal, readApiErrorCode } from '@/core/infra/api-client';
import { INVITE_EXPIRED_MESSAGE, joinErrorMessage } from '@/core/infra/join-flow';
import { keyUnavailableMessage } from '@/core/offline/offline-copy';
import { isInviteToken } from '@/core/utils/invite-token';
import posthog from '@/shared/lib/analytics';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type UnclaimedMember = { id: string; name: string };

export type InvitePhase =
	| { kind: 'loading' }
	| { kind: 'signed-out' }
	| { kind: 'ready'; wgName: string; code: string; unclaimed: UnclaimedMember[] }
	| { kind: 'dead'; reason: 'invalid' | 'expired' }
	| { kind: 'error' };

/** The WG a 409 lookup answer points at (the account is already a member), or ''. */
async function readShareCode(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { shareCode?: unknown };
		return typeof body.shareCode === 'string' ? body.shareCode : '';
	} catch {
		return '';
	}
}

/** Looks the invitation up for the signed-in account, then joins the WG with the typed name. */
export function useInviteJoin(token: string) {
	const router = useRouter();
	const [phase, setPhase] = useState<InvitePhase>({ kind: 'loading' });
	const [retryNonce, setRetryNonce] = useState(0);
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [nameInvalid, setNameInvalid] = useState(false);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const requestRef = useRef<PendingIdempotentRequest | null>(null);

	// The prefilled account name can arrive after an early submit; the "fehlt" error must not outlive it.
	useEffect(() => {
		if (nameInvalid && name.trim()) {
			setNameInvalid(false);
			setError(null);
		}
	}, [name, nameInvalid]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `retryNonce` re-runs the lookup after a transient error.
	useEffect(() => {
		if (!isInviteToken(token)) {
			setPhase({ kind: 'dead', reason: 'invalid' });
			return;
		}
		if (!hasSessionCookie()) {
			setPhase({ kind: 'signed-out' });
			return;
		}
		const controller = new AbortController();
		setPhase({ kind: 'loading' });
		fetch(`/api/wg/invites/${encodeURIComponent(token)}`, {
			cache: 'no-store',
			signal: anySignal([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		})
			.then(async (res) => {
				if (res.status === 401) return setPhase({ kind: 'signed-out' });
				if (res.status === 409) {
					const shareCode = await readShareCode(res);
					if (shareCode) return router.replace(`/wg/${encodeURIComponent(shareCode)}`);
				}
				if (res.status === 404) return setPhase({ kind: 'dead', reason: 'invalid' });
				if (res.status === 410) return setPhase({ kind: 'dead', reason: 'expired' });
				if (!res.ok) return setPhase({ kind: 'error' });
				const data = (await res.json()) as {
					wg: { name: string; shareCode: string };
					unclaimed?: UnclaimedMember[];
				};
				setPhase({
					kind: 'ready',
					wgName: data.wg.name,
					code: data.wg.shareCode,
					unclaimed: Array.isArray(data.unclaimed) ? data.unclaimed : [],
				});
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError' && controller.signal.aborted)
					return;
				setPhase({ kind: 'error' });
			});
		return () => controller.abort();
	}, [token, retryNonce, router]);

	async function join(): Promise<void> {
		if (busyRef.current || phase.kind !== 'ready') return;
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			setNameInvalid(true);
			setError('Dein Anzeigename fehlt.');
			return;
		}
		busyRef.current = true;
		setBusy(true);
		setError(null);
		setNameInvalid(false);
		// A retry of the same request keeps its key, so a lost response cannot join twice.
		const fingerprint = JSON.stringify({ token, name: trimmed });
		const key = resolveIdempotencyKey(requestRef.current, fingerprint);
		if (!key) {
			setError(keyUnavailableMessage('WG-Beitritt', 'gesendet'));
			busyRef.current = false;
			setBusy(false);
			return;
		}
		requestRef.current = { fingerprint, key };
		const target = `/wg/${encodeURIComponent(phase.code)}`;
		try {
			const res = await fetch(`/api/wg/${encodeURIComponent(phase.code)}/members`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
				body: JSON.stringify({ name: trimmed, inviteToken: token }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (res.status === 401) return setPhase({ kind: 'signed-out' });
			if (!res.ok) {
				const apiError = await readApiErrorCode(res);
				if (shouldReleaseIdempotencyKey(res.status, apiError)) requestRef.current = null;
				if (res.status === 409 && apiError === 'already_joined') return router.push(target);
				if (apiError === 'invite_expired' || apiError === 'invite_required') {
					return setPhase({ kind: 'dead', reason: 'expired' });
				}
				const nameProblem =
					apiError === 'name_invalid' || (res.status === 409 && apiError === 'name_taken');
				setNameInvalid(nameProblem);
				setError(joinErrorMessage(res.status, apiError));
				return;
			}
			requestRef.current = null;
			posthog.capture('wg_joined');
			router.push(target);
		} catch {
			setError(joinErrorMessage(0, ''));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	/** Takes over a profile that was created before accounts existed instead of joining as new. */
	async function claim(memberId: string): Promise<void> {
		if (busyRef.current || phase.kind !== 'ready') return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		setNameInvalid(false);
		try {
			const res = await fetch(
				`/api/wg/${encodeURIComponent(phase.code)}/members/${encodeURIComponent(memberId)}/claim?invite=${encodeURIComponent(token)}`,
				{ method: 'POST', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
			);
			if (res.status === 401) return setPhase({ kind: 'signed-out' });
			if (!res.ok) {
				const apiError = await readApiErrorCode(res);
				if (apiError === 'invite_expired' || apiError === 'invite_required') {
					return setPhase({ kind: 'dead', reason: 'expired' });
				}
				setError(
					apiError === 'member_already_linked'
						? 'Dieses Profil gehört schon zu einem Konto.'
						: apiError === 'account_already_linked'
							? 'Dein Konto ist in dieser WG schon Mitglied.'
							: joinErrorMessage(res.status, apiError),
				);
				return;
			}
			router.push(`/wg/${encodeURIComponent(phase.code)}`);
		} catch {
			setError(joinErrorMessage(0, ''));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	return {
		phase,
		claim,
		name,
		setName,
		error,
		nameInvalid,
		busy,
		join,
		retry: () => setRetryNonce((n) => n + 1),
		deadMessage:
			phase.kind === 'dead' && phase.reason === 'invalid'
				? 'Dieser Einladungslink stimmt nicht. Prüfe, ob er vollständig kopiert wurde, oder bitte ein Mitglied um einen neuen.'
				: INVITE_EXPIRED_MESSAGE,
	};
}

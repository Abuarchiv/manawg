'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { hasSessionCookie } from '@/core/auth/session-hint';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { anySignal, REQUEST_TIMEOUT_MS, readApiErrorCode } from '@/core/infra/api-client';
import { INVITE_EXPIRED_MESSAGE, joinErrorMessage } from '@/core/infra/join-flow';
import { isInviteToken } from '@/core/utils/invite-token';
import { useMessage } from '@/shared/i18n/message';
import posthog from '@/shared/lib/analytics';

export type InvitePhase =
	| { kind: 'loading' }
	| { kind: 'signed-out' }
	| { kind: 'ready'; wgName: string; code: string }
	| { kind: 'dead'; reason: 'invalid' | 'expired' | 'unavailable' }
	| { kind: 'error' };

/** What a visitor without an account may learn from the link: the WG, who invited and how many are in. */
export type InvitePreview = { wgName: string; inviterName: string | null; memberCount: number };

function parsePreview(body: unknown): InvitePreview | null {
	if (typeof body !== 'object' || body === null) return null;
	const { wgName, inviterName, memberCount } = body as {
		wgName?: unknown;
		inviterName?: unknown;
		memberCount?: unknown;
	};
	if (typeof wgName !== 'string' || wgName === '') return null;
	return {
		wgName,
		inviterName: typeof inviterName === 'string' && inviterName ? inviterName : null,
		memberCount: typeof memberCount === 'number' && Number.isInteger(memberCount) ? memberCount : 0,
	};
}

/** The WG a 409 lookup answer points at (the account is already a member), or ''. */
async function readShareCode(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { shareCode?: unknown };
		return typeof body.shareCode === 'string' ? body.shareCode : '';
	} catch {
		return '';
	}
}

/**
 * Reports a failed join with its error code only: no name, token or WG. The code is
 * the API's own (`name_taken`, `invite_expired`, ...); the analytics filter drops anything else.
 */
function reportJoinFailure(code: string): void {
	posthog.capture('invite_join_failed', { code });
}

/** Moves focus to the name field so a screen reader lands on the marked field and its error. */
function focusNameField(): void {
	document.getElementById('join-name')?.focus();
}

/** Looks the invitation up for the signed-in account, then joins the WG with the typed name. */
export function useInviteJoin(token: string) {
	const router = useRouter();
	const render = useMessage();
	const [phase, setPhase] = useState<InvitePhase>({ kind: 'loading' });
	const [retryNonce, setRetryNonce] = useState(0);
	const [preview, setPreview] = useState<InvitePreview | null>(null);
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [nameInvalid, setNameInvalid] = useState(false);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const requestRef = useRef<PendingIdempotentRequest | null>(null);
	// The name a name error was shown for; the error stays until the name changes.
	const invalidNameRef = useRef<string | null>(null);

	// The prefilled account name can arrive after an early submit; the "name missing" error must not outlive it.
	useEffect(() => {
		if (nameInvalid && name.trim() && name !== invalidNameRef.current) {
			setNameInvalid(false);
			setError(null);
		}
	}, [name, nameInvalid]);

	// Once per page load, as soon as the invitation is shown or has failed to (a dead link counts as
	// opened): never for the loading state, and not again when the lookup is retried.
	const openedRef = useRef(false);
	useEffect(() => {
		if (phase.kind === 'loading' || openedRef.current) return;
		openedRef.current = true;
		posthog.capture('invite_opened');
	}, [phase.kind]);

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
				const data = (await res.json()) as { wg: { name: string; shareCode: string } };
				setPhase({ kind: 'ready', wgName: data.wg.name, code: data.wg.shareCode });
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError' && controller.signal.aborted)
					return;
				setPhase({ kind: 'error' });
			});
		return () => controller.abort();
	}, [token, retryNonce, router]);

	// A visitor without an account sees who invited them to which WG. A link that cannot be used
	// ends here instead of after the sign-up; any other failure just leaves the generic page.
	const signedOut = phase.kind === 'signed-out';
	useEffect(() => {
		if (!signedOut) return;
		const controller = new AbortController();
		fetch(`/api/wg/invites/${encodeURIComponent(token)}/preview`, {
			cache: 'no-store',
			signal: anySignal([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		})
			.then(async (res) => {
				if (res.status === 404) return setPhase({ kind: 'dead', reason: 'unavailable' });
				if (!res.ok) return;
				setPreview(parsePreview(await res.json()));
			})
			.catch(() => undefined);
		return () => controller.abort();
	}, [signedOut, token]);

	async function join(): Promise<void> {
		if (busyRef.current || phase.kind !== 'ready') return;
		const trimmed = name.trim();
		if (trimmed.length === 0) {
			invalidNameRef.current = name;
			setNameInvalid(true);
			setError(render({ key: 'entry.errors.displayNameMissing' }));
			focusNameField();
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
			setError(render({ key: 'entry.errors.joinKeyUnavailable' }));
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
					// Expiry found on submit is a rejected join; a dead link merely opened is not.
					reportJoinFailure(apiError);
					return setPhase({ kind: 'dead', reason: 'expired' });
				}
				const nameProblem =
					apiError === 'name_invalid' || (res.status === 409 && apiError === 'name_taken');
				if (nameProblem) invalidNameRef.current = name;
				reportJoinFailure(apiError || `http_${res.status}`);
				setNameInvalid(nameProblem);
				setError(render(joinErrorMessage(res.status, apiError)));
				if (nameProblem) focusNameField();
				return;
			}
			requestRef.current = null;
			posthog.capture('wg_joined');
			router.push(target);
		} catch {
			reportJoinFailure('network_error');
			setError(render(joinErrorMessage(0, '')));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	return {
		phase,
		preview,
		name,
		setName,
		error,
		nameInvalid,
		busy,
		join,
		retry: () => setRetryNonce((n) => n + 1),
		deadMessage: render(
			phase.kind === 'dead' && phase.reason === 'invalid'
				? { key: 'entry.errors.inviteInvalid' }
				: phase.kind === 'dead' && phase.reason === 'unavailable'
					? { key: 'entry.errors.inviteUnavailable' }
					: INVITE_EXPIRED_MESSAGE,
		),
	};
}

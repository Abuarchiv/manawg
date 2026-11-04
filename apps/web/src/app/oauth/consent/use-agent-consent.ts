'use client';

import { useEffect, useRef, useState } from 'react';
import { hasSessionCookie } from '@/core/auth/session-hint';
import { anySignal, REQUEST_TIMEOUT_MS } from '@/core/infra/api-client';

export type ConsentPhase =
	| { kind: 'loading' }
	| { kind: 'signed-out' }
	| { kind: 'invalid' }
	| { kind: 'error' }
	| { kind: 'returning' }
	| {
			kind: 'consent';
			authorizationId: string;
			clientName: string | null;
			clientHost: string | null;
			email: string;
	  };

type ConsentAnswer =
	| { status: 'invalid' }
	| { status: 'redirect'; redirectUrl: string }
	| {
			status: 'consent';
			authorizationId: string;
			clientName: string | null;
			clientHost: string | null;
			email: string;
	  };

/** Reads the pending authorization request and sends the decision; the agent gets the result. */
export function useAgentConsent(authorizationId: string) {
	const [phase, setPhase] = useState<ConsentPhase>({ kind: 'loading' });
	const [decision, setDecision] = useState<'approve' | 'deny' | null>(null);
	const [decideFailed, setDecideFailed] = useState(false);
	const [retryNonce, setRetryNonce] = useState(0);
	const busyRef = useRef(false);

	function follow(answer: ConsentAnswer): void {
		if (answer.status === 'invalid') {
			setPhase({ kind: 'invalid' });
			return;
		}
		if (answer.status === 'redirect') {
			setPhase({ kind: 'returning' });
			// A navigation, not a form post: the page's CSP limits form targets to this origin.
			window.location.assign(answer.redirectUrl);
			return;
		}
		setPhase({ kind: 'consent', ...answer });
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: `retryNonce` re-runs the lookup after a transient error.
	useEffect(() => {
		if (!authorizationId) {
			setPhase({ kind: 'invalid' });
			return;
		}
		if (!hasSessionCookie()) {
			setPhase({ kind: 'signed-out' });
			return;
		}
		const controller = new AbortController();
		setPhase({ kind: 'loading' });
		fetch(`/api/auth/agent-consent?authorization_id=${encodeURIComponent(authorizationId)}`, {
			cache: 'no-store',
			signal: anySignal([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
		})
			.then(async (res) => {
				if (res.status === 401) return setPhase({ kind: 'signed-out' });
				if (!res.ok) return setPhase({ kind: 'error' });
				follow((await res.json()) as ConsentAnswer);
			})
			.catch(() => {
				if (!controller.signal.aborted) setPhase({ kind: 'error' });
			});
		return () => controller.abort();
	}, [authorizationId, retryNonce]);

	async function decide(approve: boolean): Promise<void> {
		if (busyRef.current || phase.kind !== 'consent') return;
		busyRef.current = true;
		setDecision(approve ? 'approve' : 'deny');
		setDecideFailed(false);
		try {
			const res = await fetch('/api/auth/agent-consent', {
				method: 'POST',
				cache: 'no-store',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ authorizationId: phase.authorizationId, approve }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (res.status === 401) return setPhase({ kind: 'signed-out' });
			if (!res.ok) return setDecideFailed(true);
			follow((await res.json()) as ConsentAnswer);
		} catch {
			setDecideFailed(true);
		} finally {
			busyRef.current = false;
			setDecision(null);
		}
	}

	return { phase, decision, decideFailed, decide, retry: () => setRetryNonce((n) => n + 1) };
}

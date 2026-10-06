import {
	EXPECTED_MEMBER_ID_HEADER,
	MEMBER_ID_HEADER,
	MEMBER_TOKEN_HEADER,
} from '@/shared/lib/member-header';

/** A request the server has not answered by then counts as a network failure. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * `AbortSignal.any`, with a fallback for browsers that lack it. The app
 * supports Safari 16.4+, but `AbortSignal.any` only exists from Safari 17.4;
 * calling it there throws, and every request with a caller signal (offline
 * sync, background refresh) would fail without reaching the server.
 */
export function anySignal(signals: readonly AbortSignal[]): AbortSignal {
	if (typeof AbortSignal.any === 'function') return AbortSignal.any([...signals]);
	const controller = new AbortController();
	for (const source of signals) {
		if (source.aborted) {
			controller.abort(source.reason);
			break;
		}
		source.addEventListener('abort', () => controller.abort(source.reason), {
			once: true,
			signal: controller.signal,
		});
	}
	return controller.signal;
}

type ApiFetchInit = RequestInit & { memberId?: string; memberToken?: string | undefined };

/** status 0 means no trustworthy result was received; a write may still have committed. */
type ApiFetchResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

let mutationCount = 0;
let sendMemberIdHeader = false;

/**
 * Called once by the app shell. `memberIdHeader` sends the caller's member id
 * as the identity header, for a server that authenticates by that header
 * instead of a session (the database-free test build); off everywhere else.
 */
export function configureApiClient(options: { memberIdHeader: boolean }): void {
	sendMemberIdHeader = options.memberIdHeader;
}

export const MEMBERSHIP_LOST_EVENT = 'manawg:membership-lost';
const MEMBERSHIP_LOST_ERRORS = new Set(['not_a_member', 'member_deactivated', 'wg_not_found']);

/**
 * Increases after every settled non-GET request. A cached read that started
 * before the latest mutation may not contain its effect (useCachedFetch).
 */
export function mutationGeneration(): number {
	return mutationCount;
}

export async function apiFetch<T>(
	path: string,
	init: ApiFetchInit = {},
): Promise<ApiFetchResult<T>> {
	const { memberId, memberToken, signal, ...rest } = init;
	const method = rest.method ?? 'GET';

	const headers = new Headers(rest.headers);
	if (memberId) headers.set(EXPECTED_MEMBER_ID_HEADER, memberId);
	if (sendMemberIdHeader && memberId) {
		headers.set(MEMBER_ID_HEADER, memberId);
	}
	if (memberToken) {
		headers.set(MEMBER_TOKEN_HEADER, memberToken);
	}
	const hasBody = rest.body !== undefined && rest.body !== null;
	if (hasBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
		headers.set('content-type', 'application/json');
	}

	const isMutation = method !== 'GET' && method !== 'HEAD';
	try {
		const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
		const requestSignal = signal ? anySignal([signal, timeoutSignal]) : timeoutSignal;
		const res = await fetch(path, {
			cache: 'no-store',
			...rest,
			method,
			headers,
			signal: requestSignal,
		});

		if (res.status === 204) return { ok: true, data: undefined as T };

		if (!res.ok) {
			let error = res.statusText;
			try {
				const body = (await res.json()) as { code?: unknown; error?: unknown };
				if (typeof body.error === 'string' && body.error.length > 0) {
					error = body.error;
				} else if (typeof body.code === 'string' && body.code.length > 0) {
					error = body.code;
				}
			} catch {
				// keep statusText
			}
			// Removed, left, or the share code rotated while the app was open: every screen
			// would otherwise show an empty list. The WG shell reacts (explain or redirect).
			if (
				(res.status === 401 || res.status === 404) &&
				MEMBERSHIP_LOST_ERRORS.has(error) &&
				typeof window !== 'undefined' &&
				path.startsWith('/api/wg/')
			) {
				window.dispatchEvent(new CustomEvent(MEMBERSHIP_LOST_EVENT, { detail: { path, error } }));
			}
			return { ok: false, status: res.status, error };
		}

		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('application/json')) {
			await res.text();
			return {
				ok: false,
				status: 0,
				error: 'Unerwartete Serverantwort',
			};
		}
		try {
			const data = (await res.json()) as T;
			return { ok: true, data };
		} catch {
			return {
				ok: false,
				status: 0,
				error: 'Unerwartete Serverantwort',
			};
		}
	} catch {
		return { ok: false, status: 0, error: 'Netzwerkfehler' };
	} finally {
		if (isMutation) mutationCount += 1;
	}
}

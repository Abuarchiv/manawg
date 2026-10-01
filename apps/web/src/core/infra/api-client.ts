import {
	EXPECTED_MEMBER_ID_HEADER,
	MEMBER_ID_HEADER,
	MEMBER_TOKEN_HEADER,
} from '@/shared/lib/member-header';

type ApiFetchInit = RequestInit & { memberId?: string; memberToken?: string | undefined };

/** status 0 means no trustworthy result was received; a write may still have committed. */
type ApiFetchResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

let mutationCount = 0;

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
	if (
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true' &&
		process.env.NEXT_PUBLIC_DB_DOWN === 'true' &&
		memberId
	) {
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
		const timeoutSignal = AbortSignal.timeout(15_000);
		const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
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

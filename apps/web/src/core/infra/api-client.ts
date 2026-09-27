import {
	EXPECTED_MEMBER_ID_HEADER,
	MEMBER_ID_HEADER,
	MEMBER_TOKEN_HEADER,
} from '@/shared/lib/member-header';

type ApiFetchInit = RequestInit & { memberId?: string; memberToken?: string | undefined };

type ApiFetchResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

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
			return { ok: false, status: res.status, error };
		}

		// 204/empty bodies are legitimate success responses — parsing them
		// would throw and get misreported as a network failure (status 0),
		// which offline queueing would then replay as a duplicate mutation.
		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.includes('application/json')) {
			const body = await res.text();
			if (body.length === 0) return { ok: true, data: undefined as T };
			return {
				ok: false,
				status: res.status,
				error: res.statusText || 'Unerwartete Serverantwort',
			};
		}
		try {
			const data = (await res.json()) as T;
			return { ok: true, data };
		} catch {
			return {
				ok: false,
				status: res.status,
				error: res.statusText || 'Unerwartete Serverantwort',
			};
		}
	} catch {
		return { ok: false, status: 0, error: 'Netzwerkfehler' };
	}
}

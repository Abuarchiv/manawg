const MEMBER_ID_HEADER = 'x-manawg-member-id';
const MEMBER_TOKEN_HEADER = 'x-manawg-member-token';

type ApiFetchInit = RequestInit & { memberId?: string; memberToken?: string };

type ApiFetchResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function apiFetch<T>(
	path: string,
	init: ApiFetchInit = {},
): Promise<ApiFetchResult<T>> {
	const { memberId, memberToken, ...rest } = init;

	const headers = new Headers(rest.headers as HeadersInit | undefined);

	if (memberId) {
		headers.set(MEMBER_ID_HEADER, memberId);
	}
	if (memberToken) {
		headers.set(MEMBER_TOKEN_HEADER, memberToken);
	}

	const method = (rest.method ?? 'GET').toUpperCase();
	const hasBody = rest.body !== undefined && rest.body !== null;
	if (hasBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
		headers.set('content-type', 'application/json');
	}

	try {
		const res = await fetch(path, {
			cache: 'no-store',
			...rest,
			headers,
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
			return { ok: true, data: undefined as T };
		}
		const data = (await res.json()) as T;
		return { ok: true, data };
	} catch {
		return { ok: false, status: 0, error: 'Netzwerkfehler' };
	}
}

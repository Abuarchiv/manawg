import { createClient } from '@supabase/supabase-js';
import { supabaseFetch } from './supabase-fetch';

const AUTH_DELETE_TIMEOUT_MS = 4_000;

export type AuthDeleteOptions = {
	fetch?: typeof fetch;
	timeoutMs?: number;
};

export async function deleteAuthUser(
	url: string,
	serviceRoleKey: string,
	authUserId: string,
	options: AuthDeleteOptions = {},
): Promise<boolean> {
	const fetchImpl = options.fetch ?? supabaseFetch;
	const timeoutMs = options.timeoutMs ?? AUTH_DELETE_TIMEOUT_MS;
	let explicitlyMissing = false;
	const boundedFetch: typeof fetch = async (input, init) => {
		const signals = [AbortSignal.timeout(timeoutMs)];
		if (init?.signal) signals.push(init.signal);
		const response = await fetchImpl(input, { ...init, signal: AbortSignal.any(signals) });
		if (response.status === 404) {
			const body: unknown = await response
				.clone()
				.json()
				.catch(() => null);
			if (
				body &&
				typeof body === 'object' &&
				(('error_code' in body && body.error_code === 'user_not_found') ||
					('code' in body && body.code === 'user_not_found'))
			) {
				explicitlyMissing = true;
			}
		}
		return response;
	};

	const admin = createClient(url, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { fetch: boundedFetch },
	}).auth.admin;
	try {
		const { error } = await admin.deleteUser(authUserId, false);
		if (!error) return true;
		return explicitlyMissing || isExplicitUserNotFound(error);
	} catch {
		return explicitlyMissing;
	}
}

function isExplicitUserNotFound(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === 'object' &&
		'code' in error &&
		error.code === 'user_not_found' &&
		'status' in error &&
		error.status === 404
	);
}

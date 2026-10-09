import 'server-only';
import { createClient } from '@supabase/supabase-js';

const LOOKUP_TIMEOUT_MS = 5_000;
const LOOKUP_CONCURRENCY = 10;

export interface ConfirmedEmails {
	/** Confirmed e-mail address per Supabase Auth user id. */
	emails: Map<string, string>;
	/** Ids Auth did not answer for (timeout, 429, 5xx): unknown, not "has no address". */
	unresolved: Set<string>;
}

/**
 * Confirmed e-mail addresses per Supabase Auth user id. Users that are deleted,
 * unknown to Auth (404) or have not confirmed their address are absent from
 * `emails`; users whose lookup failed are listed in `unresolved`. Throws when
 * the service-role configuration is missing, so a misconfiguration is never
 * mistaken for "nobody has an address".
 */
export async function loadConfirmedEmails(
	authUserIds: readonly string[],
): Promise<ConfirmedEmails> {
	const result: ConfirmedEmails = { emails: new Map(), unresolved: new Set() };
	if (authUserIds.length === 0) return result;
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!url || !serviceRoleKey) {
		throw new Error('Supabase service-role configuration is missing');
	}

	const admin = createClient(url, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: {
			fetch: (input, init) =>
				fetch(input, { ...init, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }),
		},
	}).auth.admin;

	const queue = [...new Set(authUserIds)];
	async function worker(): Promise<void> {
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			try {
				const { data, error } = await admin.getUserById(id);
				if (error && error.status !== 404) {
					result.unresolved.add(id);
					continue;
				}
				const user = data.user;
				if (user?.email && user.email_confirmed_at) result.emails.set(id, user.email);
			} catch {
				result.unresolved.add(id);
			}
		}
	}
	await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
	return result;
}

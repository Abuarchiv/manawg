import 'server-only';
import { createClient } from '@supabase/supabase-js';

const LOOKUP_TIMEOUT_MS = 5_000;
const LOOKUP_CONCURRENCY = 10;

/**
 * Confirmed e-mail address per Supabase Auth user id. Users that are deleted,
 * unknown or have not confirmed their address are absent from the result.
 * Without service-role configuration the result is empty.
 */
export async function loadConfirmedEmails(
	authUserIds: readonly string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!url || !serviceRoleKey || authUserIds.length === 0) return result;

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
				const { data } = await admin.getUserById(id);
				const user = data.user;
				if (user?.email && user.email_confirmed_at) result.set(id, user.email);
			} catch {
				// An unreachable lookup leaves the member without an address: skipped, retried next run.
			}
		}
	}
	await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
	return result;
}

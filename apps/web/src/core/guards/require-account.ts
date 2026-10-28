import type { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/core/auth/server';
import type { AuthenticatedUser } from '@/core/guards/api-auth';
import { serviceUnavailable, unauthorized } from '@/core/http/api-errors';
import { logApiError } from '@/core/infra/observability';

export type AccountResult =
	| { ok: true; user: AuthenticatedUser }
	| { ok: false; response: NextResponse };

/**
 * The signed-in account behind a request, for routes outside a WG membership (account, uploads,
 * WG creation and joining). A transient Auth outage answers a retryable 503, not 401: the caller
 * is not unauthenticated, the check could not run.
 */
export async function requireAccount(req: NextRequest, label: string): Promise<AccountResult> {
	let user: AuthenticatedUser | null;
	try {
		user = await getAuthenticatedUser(req);
	} catch (err) {
		logApiError(`[${label}] auth error`, err);
		return { ok: false, response: serviceUnavailable('db_error') };
	}
	if (!user) return { ok: false, response: unauthorized('auth_required', 'auth_required') };
	return { ok: true, user };
}

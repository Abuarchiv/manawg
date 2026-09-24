import { recordAuditEvent } from '@/core/audit';
import { getSupabaseEnv, hasSupabaseEnv } from '@/core/auth/env';
import { getAuthenticatedUser } from '@/core/auth/server';
import { removeAccountFromWgs } from '@/core/db/delete-account';
import { withTransaction } from '@/core/db/transaction';
import { apiError, serverError } from '@/core/errors';
import { logApiError } from '@/core/infra/observability';
import { createClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

const SUPABASE_AUTH_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

/**
 * Deletes the signed-in account (Art. 17 DSGVO). WG data is handled by
 * `removeAccountFromWgs`; the auth user is removed last, so a failed provider
 * call can simply be retried.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!hasSupabaseEnv() || !serviceRoleKey) {
		return apiError('account_deletion_unavailable', 503, 'account_deletion_unavailable');
	}
	const user = await getAuthenticatedUser(req);
	if (!user) return apiError('unauthorized', 401, 'auth_required');

	try {
		const { left, deletedWgIds } = await withTransaction((tx) => removeAccountFromWgs(tx, user.id));

		for (const { wgId, memberId, name, newAdminId } of left) {
			await recordAuditEvent({
				wgId,
				memberId,
				eventType: 'member.account_deleted',
				entityType: 'member',
				entityId: memberId,
				summary: `${name} hat das Konto gelöscht und ist ausgezogen.`,
				metadata: { name, newAdminId },
			});
		}

		const { url } = getSupabaseEnv();
		const admin = createClient(url, serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		});
		const { error } = await admin.auth.admin.deleteUser(user.id);
		if (error) throw error;

		const response = NextResponse.json({ deleted: true, deletedWgs: deletedWgIds.length });
		for (const { name } of req.cookies.getAll()) {
			if (SUPABASE_AUTH_COOKIE.test(name))
				response.cookies.set({ name, value: '', maxAge: 0, path: '/' });
		}
		return response;
	} catch (err) {
		logApiError('[api/account DELETE] failed', err);
		return serverError('account_deletion_failed');
	}
}

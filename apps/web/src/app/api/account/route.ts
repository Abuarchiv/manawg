import { deleteAuthUser } from '@/core/auth/delete-user';
import { getSupabaseEnv, hasSupabaseEnv } from '@/core/auth/env';
import { getAuthenticatedUser } from '@/core/auth/server';
import { accountDeletions, auditEvents } from '@/core/db';
import { tryCompleteAccountDeletion } from '@/core/db/account-deletion';
import { removeAccountFromWgs } from '@/core/db/delete-account';
import { withTransaction } from '@/core/db/transaction';
import { apiError, serverError } from '@/core/errors';
import { logApiError } from '@/core/infra/observability';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

const SUPABASE_AUTH_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

/** Deletes local access first, then completes the Auth request or leaves it retryable. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!hasSupabaseEnv() || !serviceRoleKey) {
		return apiError('account_deletion_unavailable', 503, 'account_deletion_unavailable');
	}
	const user = await getAuthenticatedUser(req);
	if (!user) return apiError('unauthorized', 401, 'auth_required');

	try {
		const { url } = getSupabaseEnv();
		const local = await withTransaction(async (tx) => {
			const removed = await removeAccountFromWgs(tx, user.id);
			const [deletion] = await tx
				.select({ completedAt: accountDeletions.completedAt })
				.from(accountDeletions)
				.where(eq(accountDeletions.authUserId, user.id))
				.limit(1);
			if (!deletion) throw new Error('account_deletion_fence_missing');

			for (const { wgId, memberId, name, newAdminId } of removed.left) {
				await tx.insert(auditEvents).values({
					wgId,
					memberId,
					eventType: 'member.account_deletion_requested',
					entityType: 'member',
					entityId: memberId,
					summary: `${name} hat die Kontolöschung angefragt und ist ausgezogen.`,
					metadataJson: JSON.stringify({ name, newAdminId }),
				});
			}
			return { deletedWgs: removed.deletedWgIds.length, completedAt: deletion.completedAt };
		});

		const completed =
			Boolean(local.completedAt) ||
			(await tryCompleteAccountDeletion(user.id, (authUserId) =>
				deleteAuthUser(url, serviceRoleKey, authUserId),
			));
		const response = NextResponse.json(
			completed ? { status: 'completed', deletedWgs: local.deletedWgs } : { status: 'pending' },
			{ status: completed ? 200 : 202 },
		);
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

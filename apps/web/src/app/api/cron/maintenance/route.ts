import { deleteAuthUser } from '@/core/auth/delete-user';
import { getSupabaseEnv, hasSupabaseEnv } from '@/core/auth/env';
import { retryPendingAccountDeletions } from '@/core/db/account-deletion';
import { purgeExpiredIdempotencyResponses } from '@/core/idempotency';
import { verifyCronSecret } from '@/core/infra/cron-auth';
import { logApiError, withCronLogging } from '@/core/infra/observability';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Housekeeping cron. Currently: remove idempotency responses past their TTL.
 * They are invisible to every reader (`expiresAt` filters) but nothing else
 * ever deleted them, so the table grew forever.
 */
export const GET = withCronLogging(
	'maintenance',
	async (req: NextRequest): Promise<NextResponse> => {
		const secret = process.env.CRON_SECRET;
		if (!secret) {
			return new NextResponse('cron_secret_missing', { status: 503 });
		}
		if (!verifyCronSecret(req.headers.get('authorization'), secret)) {
			return new NextResponse('unauthorized', { status: 401 });
		}

		const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
		const auth = hasSupabaseEnv() && serviceRoleKey ? getSupabaseEnv() : null;
		const deleteAuth =
			auth && serviceRoleKey
				? (authUserId: string) => deleteAuthUser(auth.url, serviceRoleKey, authUserId)
				: null;
		const [purge, deletions] = await Promise.allSettled([
			purgeExpiredIdempotencyResponses(),
			retryPendingAccountDeletions(deleteAuth),
		]);
		if (purge.status === 'rejected')
			logApiError('[maintenance] idempotency cleanup failed', purge.reason);
		if (deletions.status === 'rejected') {
			logApiError('[maintenance] account deletion recovery failed', deletions.reason);
		}
		const recoveryPending =
			deletions.status === 'fulfilled' &&
			(!deleteAuth ? deletions.value.pending > 0 : deletions.value.failed > 0);
		const ok = purge.status === 'fulfilled' && deletions.status === 'fulfilled' && !recoveryPending;
		return NextResponse.json(
			{
				ok,
				purgedIdempotencyRows: purge.status === 'fulfilled' ? purge.value : null,
				accountDeletions:
					deletions.status === 'fulfilled'
						? { ...deletions.value, authAdminAvailable: Boolean(deleteAuth) }
						: {
								attempted: 0,
								completed: 0,
								failed: 0,
								pending: null,
								authAdminAvailable: Boolean(deleteAuth),
							},
			},
			{ status: ok ? 200 : 503 },
		);
	},
);

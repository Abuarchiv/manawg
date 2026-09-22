import { purgeExpiredIdempotencyResponses } from '@/core/idempotency';
import { verifyCronSecret } from '@/core/infra/cron-auth';
import { withCronLogging } from '@/core/infra/observability';
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

		const purgedIdempotencyRows = await purgeExpiredIdempotencyResponses();
		return NextResponse.json({ ok: true, purgedIdempotencyRows });
	},
);

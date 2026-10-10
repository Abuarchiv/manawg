import { runDailyDigest } from '@/composition/daily-digest';
import { requireCronSecret } from '@/core/infra/cron-auth';
import { withCronLogging } from '@/core/infra/observability';
import { type NextRequest, NextResponse } from 'next/server';

// One mail per member; the ledger makes a rerun on the same day a no-op.
export const maxDuration = 60;

export const GET = withCronLogging(
	'daily-digest',
	async (req: NextRequest): Promise<NextResponse> => {
		const denied = requireCronSecret(req);
		if (denied) return denied;
		return NextResponse.json(await runDailyDigest());
	},
);

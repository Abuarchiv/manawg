import { requireCronSecret } from '@/core/infra/cron-auth';
import { withCronLogging } from '@/core/infra/observability';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { berlinMonthKey, shiftMonthKey } from '@/features/expenses/monthly-statement';
import { runMonthlyStatements } from '@/features/expenses/server/statement-run';
import { createStatementTransport } from '@/features/expenses/server/statement-transport';
import { type NextRequest, NextResponse } from 'next/server';

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
// Day 1 sends; days 2-5 retry what failed or was deferred by the provider quota.
const LAST_SEND_DAY = 5;

// Many batches plus paced single resends can outlast the default function limit.
export const maxDuration = 60;

export const GET = withCronLogging(
	'monthly-statements',
	async (req: NextRequest): Promise<NextResponse> => {
		const denied = requireCronSecret(req);
		if (denied) return denied;

		const now = new Date();
		const params = req.nextUrl.searchParams;
		const day = Number(berlinDayKey(now).slice(8, 10));
		if (day > LAST_SEND_DAY && params.get('force') !== '1') {
			return NextResponse.json({ skipped: 'outside_send_window' });
		}
		const requested = params.get('month');
		if (requested !== null && !MONTH_PARAM.test(requested)) {
			return NextResponse.json({ error: 'invalid_month' }, { status: 400 });
		}
		// Statements cover the finished month; the current one is never mailed.
		const currentMonth = berlinMonthKey(now);
		const monthKey = requested ?? shiftMonthKey(currentMonth, -1);
		if (monthKey >= currentMonth) {
			return NextResponse.json({ error: 'month_not_finished' }, { status: 400 });
		}

		const summary = await runMonthlyStatements(monthKey, createStatementTransport());
		return NextResponse.json(summary);
	},
);

import { readShareCode } from '@/core/guards/route-preamble';
import { serverError, tooMany } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, dashboardLimiter } from '@/core/rate-limit';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;

	try {
		// Dynamic imports keep DB-backed modules out of the route module's top
		// level, so the module itself stays importable without a database.
		const [{ requireWgMember }, { loadDashboardData }] = await Promise.all([
			import('@/core/guards/require-wg-member'),
			import('@/composition/dashboard-data'),
		]);
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;

		// Route-level throttle on top of the middleware's per-IP read limit:
		// this response is the WG's financial overview, so scraping it gets its
		// own per-member bucket instead of sharing the general read budget.
		const limit = await checkRateLimit(
			dashboardLimiter,
			`dashboard:${auth.wg.id}:${auth.member.memberId}`,
		);
		if (!limit.success) return tooMany('rate_limited');

		const data = await loadDashboardData(auth.wg.id, auth.member.memberId, code);
		return NextResponse.json(data);
	} catch (err) {
		logApiError('[dashboard GET]', err);
		return serverError(err);
	}
}

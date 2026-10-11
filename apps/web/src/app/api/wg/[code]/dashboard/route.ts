import { withWgRoute } from '@/core/guards/with-wg-route';
import { rateLimitResponse } from '@/core/http/api-errors';
import { checkRateLimit, dashboardLimiter } from '@/core/rate-limit';
import { NextResponse } from 'next/server';

export const GET = withWgRoute('dashboard GET', async (req, { code }) => {
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
	const limit = rateLimitResponse(
		await checkRateLimit(dashboardLimiter, `dashboard:${auth.wg.id}:${auth.member.memberId}`),
		'rate_limited',
	);
	if (limit) return limit;

	const data = await loadDashboardData(auth.wg.id, auth.member.memberId, code);
	return NextResponse.json(data);
});

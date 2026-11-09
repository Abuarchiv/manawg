import { NextResponse } from 'next/server';
import { loadDashboardData } from '@/composition/dashboard-data';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { rateLimitResponse } from '@/core/http/api-errors';
import { requestLocale } from '@/core/i18n/request-locale';
import { checkRateLimit, dashboardLimiter } from '@/core/rate-limit';

export const GET = withWgRoute('dashboard GET', async (req, { code }) => {
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

	const data = await loadDashboardData(auth.wg.id, auth.member.memberId, code, requestLocale(req));
	return NextResponse.json(data);
});

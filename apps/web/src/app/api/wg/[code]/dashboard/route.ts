import { serverError } from '@/lib/api-error';
import type { RouteCtx } from '@/lib/api-types';
import { buildE2EDashboardData } from '@/lib/e2e-db-down';
import { readShareCode, resolveE2EFixture } from '@/lib/wg/route-preamble';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;

	const e2e = await resolveE2EFixture(req, code);
	if (e2e.mode === 'denied') return e2e.response;
	if (e2e.mode === 'fixture') {
		return NextResponse.json(buildE2EDashboardData(code), {
			headers: { 'Cache-Control': 'private, no-store' },
		});
	}

	try {
		// Dynamic imports keep DB-backed modules out of the DB-down fixture path
		// above — the route module itself must stay importable without a DB.
		const [{ requireWgMember }, { loadDashboardData }] = await Promise.all([
			import('@/lib/wg/require-wg-member'),
			import('@/lib/wg/dashboard-data'),
		]);
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;

		const data = await loadDashboardData(auth.wg.id, auth.member.memberId, code);
		return NextResponse.json(data, {
			headers: { 'Cache-Control': 'private, no-store' },
		});
	} catch (err) {
		console.error('[dashboard GET]', err);
		return serverError(err);
	}
}

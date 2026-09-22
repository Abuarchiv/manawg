import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgMembers, wgs } from '@/core/db';
import { apiError, serverError } from '@/core/errors';
import { logApiError } from '@/core/infra/observability';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

/** Return WGs that belong to the signed-in account, so recovery needs no local data or code. */
export async function GET(req: NextRequest): Promise<NextResponse> {
	try {
		const user = await getAuthenticatedUser(req);
		if (!user) return apiError('auth_required', 401, 'auth_required');
		const memberships = await db
			.select({ id: wgs.id, memberId: wgMembers.id, name: wgs.name, code: wgs.shareCode })
			.from(wgMembers)
			.innerJoin(wgs, eq(wgMembers.wgId, wgs.id))
			.where(and(eq(wgMembers.authUserId, user.id), isNull(wgMembers.deactivatedAt)))
			.orderBy(desc(wgMembers.createdAt));
		return NextResponse.json({ wgs: memberships });
	} catch (err) {
		logApiError('[api/wg/mine GET] failed', err);
		return serverError('db_error');
	}
}

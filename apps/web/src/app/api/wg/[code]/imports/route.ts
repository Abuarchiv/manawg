import { isWgAdmin } from '@/core/guards/admin';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { tooMany } from '@/core/http/api-errors';
import { checkRateLimit, clientIpKey, wgReadLimiter } from '@/core/rate-limit';
import { listUndoableImports } from '@/features/expenses/server/import-history';
import { NextResponse } from 'next/server';

/** The latest imports the caller may still take back (own ones, or all for an admin). */
export const GET = withWgRoute('imports GET', async (req, { code }) => {
	const limit = await checkRateLimit(wgReadLimiter, `imports:${clientIpKey(req)}`);
	if (!limit.success) return tooMany('rate_limited');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const admin = await isWgAdmin(auth.wg.id, auth.member.memberId);
	const rows = await listUndoableImports(auth.wg.id, admin ? null : auth.member.memberId);
	return NextResponse.json({
		imports: rows.map((row) => ({ ...row, startedAt: row.startedAt.toISOString() })),
	});
});

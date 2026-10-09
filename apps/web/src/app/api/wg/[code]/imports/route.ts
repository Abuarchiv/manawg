import { db, expenseImports } from '@/core/db';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { tooMany } from '@/core/http/api-errors';
import { checkRateLimit, clientIpKey, wgReadLimiter } from '@/core/rate-limit';
import { and, desc, eq, gt } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const HISTORY_LIMIT = 10;

/** The latest imports that still hold expenses, so an import can be taken back after the wizard. */
export const GET = withWgRoute('imports GET', async (req, { code }) => {
	const limit = await checkRateLimit(wgReadLimiter, `imports:${clientIpKey(req)}`);
	if (!limit.success) return tooMany('rate_limited');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const rows = await db
		.select({
			id: expenseImports.id,
			source: expenseImports.source,
			startedAt: expenseImports.startedAt,
			inserted: expenseImports.rowCountInserted,
			importedByMemberId: expenseImports.importedByMemberId,
		})
		.from(expenseImports)
		.where(and(eq(expenseImports.wgId, auth.wg.id), gt(expenseImports.rowCountInserted, 0)))
		.orderBy(desc(expenseImports.startedAt))
		.limit(HISTORY_LIMIT);
	return NextResponse.json({
		imports: rows.map((row) => ({ ...row, startedAt: row.startedAt.toISOString() })),
	});
});

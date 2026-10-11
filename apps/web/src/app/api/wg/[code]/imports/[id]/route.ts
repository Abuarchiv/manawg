import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	rateLimitResponse,
} from '@/core/http/api-errors';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { undoImport } from '@/features/expenses/server/import-undo';
import { NextResponse } from 'next/server';

/** Undo a whole import: the member who ran it or an admin removes its expenses again. */
export const DELETE = withWgRoute<{ id: string }>('imports DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const { wg, member } = auth;

	const limited = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `import-undo:${wg.id}:${member.memberId}`),
	);
	if (limited) return limited;

	const result = await undoImport(wg.id, id, { memberId: member.memberId, name: member.name });
	if (!result.ok) {
		if (result.error === 'import_not_found') return notFound('import_not_found');
		if (result.error === 'not_allowed') return forbidden('not_owner', 'not_owner');
		return conflict(result.error);
	}
	return NextResponse.json({ removed: result.removed });
});

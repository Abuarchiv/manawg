import { recordAuditEvent } from '@/core/audit';
import { isWgAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, forbidden, notFound, tooMany } from '@/core/http/api-errors';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { undoImport } from '@/features/expenses/import-undo';
import { NextResponse } from 'next/server';

/** Undo a whole import: the member who ran it or an admin removes its expenses again. */
export const DELETE = withWgRoute<{ id: string }>('imports DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const { wg, member } = auth;

	const limited = await checkRateLimit(wgWriteLimiter, `import-undo:${wg.id}:${member.memberId}`);
	if (!limited.success) return tooMany();

	const result = await undoImport(
		wg.id,
		id,
		async (importedBy) =>
			importedBy === member.memberId || (await isWgAdmin(wg.id, member.memberId)),
	);
	if (!result.ok) {
		if (result.error === 'import_not_found') return notFound('import_not_found');
		if (result.error === 'not_allowed') return forbidden('not_owner', 'not_owner');
		return conflict(result.error);
	}
	await recordAuditEvent({
		wgId: wg.id,
		memberId: member.memberId,
		eventType: 'import.undone',
		entityType: 'expense_import',
		entityId: id,
		summary: `${member.name} hat einen Import rückgängig gemacht (${result.removed} ${result.removed === 1 ? 'Ausgabe' : 'Ausgaben'}).`,
		metadata: { source: result.source, removed: result.removed },
	});
	return NextResponse.json({ removed: result.removed });
});

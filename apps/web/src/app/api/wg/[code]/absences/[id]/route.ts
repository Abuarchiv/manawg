import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { recordAuditEvent } from '@/core/audit';
import { db, memberAbsences } from '@/core/db';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, notFound, rateLimitResponse } from '@/core/http/api-errors';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';

export const DELETE = withWgRoute<{ id: string }>('absences DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	// Only the absence's owner or a WG admin may delete it.
	const existing = await db
		.select({ memberId: memberAbsences.memberId })
		.from(memberAbsences)
		.where(and(eq(memberAbsences.id, id), eq(memberAbsences.wgId, wgId)))
		.limit(1);
	const target = existing[0];
	if (!target) return notFound('absence_not_found');
	const denied = await requireOwnerOrAdmin(wgId, auth.member, target.memberId);
	if (denied) return denied;
	const limited = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `absence:${wgId}:${auth.member.memberId}`),
	);
	if (limited) return limited;

	const [row] = await db
		.delete(memberAbsences)
		.where(and(eq(memberAbsences.id, id), eq(memberAbsences.wgId, wgId)))
		.returning({
			id: memberAbsences.id,
			memberId: memberAbsences.memberId,
			startDate: memberAbsences.startDate,
			endDate: memberAbsences.endDate,
		});
	if (!row) return notFound('absence_not_found');
	await recordAuditEvent({
		wgId: wgId,
		memberId: auth.member.memberId,
		eventType: 'absence.deleted',
		entityType: 'member_absence',
		entityId: id,
		actorName: auth.member.name,
		metadata: {
			memberId: row.memberId,
			startDate: row.startDate.toISOString(),
			endDate: row.endDate.toISOString(),
		},
	});
	return NextResponse.json({ deleted: row.id });
});

import { UUID_PATTERN } from '@/lib/api-auth';
import { badRequest, forbidden, notFound, tooMany } from '@/lib/api-error';
import { db, memberAbsences } from '@/lib/db';
import { checkRateLimit, wgWriteLimiter } from '@/lib/rate-limit';
import { isVerifiedWgAdmin } from '@/lib/wg/admin';
import { recordAuditEvent } from '@/lib/wg/audit';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const DELETE = withWgRoute<{ id: string }>('absences DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	// Ownership / admin gate: an absence belongs to a specific member, so only
	// that member may remove their own absence. The WG admin (oldest member)
	// can also delete to handle cleanup when a member is unreachable.
	// Without this check, any member could delete another member's absence
	// silently (P1 audit finding).
	const existing = await db
		.select({ memberId: memberAbsences.memberId })
		.from(memberAbsences)
		.where(and(eq(memberAbsences.id, id), eq(memberAbsences.wgId, wgId)))
		.limit(1);
	const target = existing[0];
	if (!target) return notFound('absence_not_found');
	const isOwner = auth.member.verified && target.memberId === auth.member.memberId;
	if (!isOwner && !(await isVerifiedWgAdmin(wgId, auth.member.memberId, auth.member.verified))) {
		return forbidden('not_owner', 'not_owner');
	}
	const limited = await checkRateLimit(wgWriteLimiter, `absence:${wgId}:${auth.member.memberId}`);
	if (!limited.success) return tooMany();

	const deleted = await db
		.delete(memberAbsences)
		.where(and(eq(memberAbsences.id, id), eq(memberAbsences.wgId, wgId)))
		.returning({
			id: memberAbsences.id,
			memberId: memberAbsences.memberId,
			startDate: memberAbsences.startDate,
			endDate: memberAbsences.endDate,
		});
	if (deleted.length === 0) return notFound('absence_not_found');
	const row = deleted[0];
	await recordAuditEvent({
		wgId: wgId,
		memberId: auth.member.memberId,
		eventType: 'absence.deleted',
		entityType: 'member_absence',
		entityId: id,
		summary: `${auth.member.name} hat eine Abwesenheit entfernt.`,
		metadata: row
			? {
					memberId: row.memberId,
					startDate: row.startDate.toISOString(),
					endDate: row.endDate.toISOString(),
				}
			: {},
	});
	return NextResponse.json({ deleted: deleted[0]?.id });
});

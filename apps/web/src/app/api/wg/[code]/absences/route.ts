import { recordAuditEvent } from '@/core/audit';
import { db, memberAbsences, wgMembers } from '@/core/db';
import { badRequest, conflict, forbidden, serverError, tooMany } from '@/core/errors';
import { isVerifiedWgAdmin } from '@/core/guards/admin';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const createAbsenceSchema = z.object({
	memberId: z.string().uuid(),
	startDate: z.string().datetime({ offset: true }),
	endDate: z.string().datetime({ offset: true }),
	reason: z.string().trim().max(120).optional().nullable(),
});

export const GET = withWgRoute(
	'absences GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;
		const rows = await db
			.select({
				id: memberAbsences.id,
				memberId: memberAbsences.memberId,
				memberName: wgMembers.name,
				startDate: memberAbsences.startDate,
				endDate: memberAbsences.endDate,
				reason: memberAbsences.reason,
			})
			.from(memberAbsences)
			.innerJoin(wgMembers, eq(wgMembers.id, memberAbsences.memberId))
			.where(and(eq(memberAbsences.wgId, wg.id), gte(memberAbsences.endDate, new Date())))
			.orderBy(asc(memberAbsences.startDate));

		return NextResponse.json({
			absences: rows.map((row) => ({
				...row,
				startDate: row.startDate.toISOString(),
				endDate: row.endDate.toISOString(),
			})),
		});
	},
	{
		fixture: () => {
			return NextResponse.json({ absences: [] });
		},
	},
);

export const POST = withWgRoute('absences POST', async (req, { code }) => {
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}
	const parsed = createAbsenceSchema.safeParse(raw);
	if (!parsed.success) {
		const issues = parsed.error.flatten();
		if (issues.fieldErrors.memberId) return badRequest('member_id_invalid');
		if (issues.fieldErrors.startDate || issues.fieldErrors.endDate)
			return badRequest('date_range_invalid');
		if (issues.fieldErrors.reason) return badRequest('reason_invalid');
		return badRequest('invalid_body');
	}
	const startDate = new Date(parsed.data.startDate);
	const endDate = new Date(parsed.data.endDate);
	if (endDate < startDate) return badRequest('date_range_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const limited = await checkRateLimit(wgWriteLimiter, `absence:${wg.id}:${auth.member.memberId}`);
	if (!limited.success) return tooMany();

	const member = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, wg.id), eq(wgMembers.id, parsed.data.memberId)))
		.limit(1);
	if (member.length === 0) return badRequest('member_not_in_wg');

	// A bare x-manawg-member-id is spoofable, so self-ownership only counts
	// with a verified HMAC token.
	const isOwner = auth.member.verified && parsed.data.memberId === auth.member.memberId;
	if (!isOwner && !(await isVerifiedWgAdmin(wg.id, auth.member.memberId, auth.member.verified))) {
		return forbidden('not_owner', 'not_owner');
	}

	const overlappingAbsence = await db
		.select({ id: memberAbsences.id })
		.from(memberAbsences)
		.where(
			and(
				eq(memberAbsences.wgId, wg.id),
				eq(memberAbsences.memberId, parsed.data.memberId),
				lte(memberAbsences.startDate, endDate),
				gte(memberAbsences.endDate, startDate),
			),
		)
		.limit(1);
	if (overlappingAbsence.length > 0) {
		return conflict('absence_overlaps_existing', 'absence_overlaps_existing');
	}

	const [absence] = await db
		.insert(memberAbsences)
		.values({
			wgId: wg.id,
			memberId: parsed.data.memberId,
			startDate,
			endDate,
			reason: parsed.data.reason || null,
		})
		.returning();
	if (!absence) return serverError('insert_failed');
	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'absence.created',
		entityType: 'absence',
		entityId: absence.id,
		summary: `${auth.member.name} hat eine Abwesenheit eingetragen.`,
		metadata: {
			memberId: parsed.data.memberId,
			startDate: absence.startDate.toISOString(),
			endDate: absence.endDate.toISOString(),
			reason: absence.reason,
		},
	});
	return NextResponse.json({
		absence: {
			...absence,
			startDate: absence.startDate.toISOString(),
			endDate: absence.endDate.toISOString(),
		},
	});
});

import { recordAuditEvent } from '@/core/audit';
import { db, memberAbsences, wgMembers } from '@/core/db';
import { bodyCodec, rejectWrite, withIdempotentWrite } from '@/core/db/idempotent-write';
import { TransactionAbort } from '@/core/db/transaction';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, conflict, rateLimitResponse, serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { berlinDayKey, endOfBerlinDay, startOfBerlinDay } from '@/core/utils/berlin-day';
import { ABSENCE_REASON_MAX } from '@/features/chores/chore-limits';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type AbsenceCreateResponseBody = {
	absence: {
		id: string;
		wgId: string;
		memberId: string;
		startDate: string;
		endDate: string;
		reason: string | null;
	};
};

const absenceCreateCodec = bodyCodec(
	(body): body is AbsenceCreateResponseBody =>
		body !== null && typeof body === 'object' && 'absence' in body,
);

const createAbsenceSchema = z.object({
	memberId: z.string().uuid(),
	startDate: z.string().datetime({ offset: true }),
	endDate: z.string().datetime({ offset: true }),
	reason: z.string().trim().max(ABSENCE_REASON_MAX).optional().nullable(),
});

export const GET = withWgRoute('absences GET', async (req, { code }) => {
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
		.where(
			and(
				eq(memberAbsences.wgId, wg.id),
				gte(memberAbsences.endDate, startOfBerlinDay(new Date())),
			),
		)
		.orderBy(asc(memberAbsences.startDate));

	return NextResponse.json({
		absences: rows.map((row) => ({
			...row,
			startDate: row.startDate.toISOString(),
			endDate: row.endDate.toISOString(),
		})),
	});
});

export const POST = withWgRoute('absences POST', async (req, { code }) => {
	const parsed = await parseBody(req, createAbsenceSchema, {
		fieldErrors: {
			memberId: 'member_id_invalid',
			startDate: 'date_range_invalid',
			endDate: 'date_range_invalid',
			reason: 'reason_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const startDate = new Date(parsed.data.startDate);
	const endDate = new Date(parsed.data.endDate);
	if (endDate.getTime() < startDate.getTime()) return badRequest('date_range_invalid');
	if (berlinDayKey(endDate) < berlinDayKey(startDate)) return badRequest('date_range_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const absentMemberId = parsed.data.memberId;

	const createAbsence = () =>
		withIdempotentWrite(
			{
				scope: `absences-create:${wg.id}:${auth.member.memberId}`,
				key: readIdempotencyKey(req),
				codec: absenceCreateCodec,
				completeFailureCode: 'idempotency_response_write_failed',
				prepare: async () => {
					const limited = rateLimitResponse(
						await checkRateLimit(wgWriteLimiter, `absence:${wg.id}:${auth.member.memberId}`),
					);
					if (limited) return { stop: limited };
					const member = await db
						.select({ id: wgMembers.id })
						.from(wgMembers)
						.where(
							and(
								eq(wgMembers.wgId, wg.id),
								eq(wgMembers.id, absentMemberId),
								isNull(wgMembers.deactivatedAt),
							),
						)
						.limit(1);
					if (member.length === 0) return { stop: badRequest('member_not_in_wg') };
					const denied = await requireOwnerOrAdmin(wg.id, auth.member, absentMemberId);
					return denied ? { stop: denied } : { input: undefined };
				},
			},
			async (tx) => {
				await tx.execute(
					sql`select pg_advisory_xact_lock(hashtext(${`absence:${wg.id}:${absentMemberId}`}))`,
				);
				const overlappingAbsence = await tx
					.select({ id: memberAbsences.id })
					.from(memberAbsences)
					.where(
						and(
							eq(memberAbsences.wgId, wg.id),
							eq(memberAbsences.memberId, absentMemberId),
							lte(memberAbsences.startDate, endOfBerlinDay(endDate)),
							gte(memberAbsences.endDate, startOfBerlinDay(startDate)),
						),
					)
					.limit(1);
				if (overlappingAbsence.length > 0) {
					return rejectWrite(conflict('absence_overlaps_existing', 'absence_overlaps_existing'));
				}
				const [created] = await tx
					.insert(memberAbsences)
					.values({
						wgId: wg.id,
						memberId: absentMemberId,
						startDate,
						endDate,
						reason: parsed.data.reason || null,
					})
					.returning();
				if (!created) throw new TransactionAbort('insert_failed');
				const body: AbsenceCreateResponseBody = {
					absence: {
						...created,
						startDate: created.startDate.toISOString(),
						endDate: created.endDate.toISOString(),
					},
				};
				return { status: 200, body, context: created };
			},
		);
	let result: Awaited<ReturnType<typeof createAbsence>>;
	try {
		result = await createAbsence();
	} catch (err) {
		if (err instanceof TransactionAbort) return serverError(err.code);
		throw err;
	}
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'replayed' || !result.context) {
		return NextResponse.json(result.body, { status: result.status });
	}
	if ('rejected' in result.context) return result.context.rejected;
	const absence = result.context;
	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'absence.created',
		entityType: 'absence',
		entityId: absence.id,
		actorName: auth.member.name,
		metadata: {
			memberId: absentMemberId,
			startDate: absence.startDate.toISOString(),
			endDate: absence.endDate.toISOString(),
			reason: absence.reason,
		},
	});
	return NextResponse.json(result.body, { status: result.status });
});

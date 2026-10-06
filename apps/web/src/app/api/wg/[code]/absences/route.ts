import { recordAuditEvent } from '@/core/audit';
import { db, memberAbsences, wgMembers } from '@/core/db';
import {
	completeClaimedResponse,
	lockClaimedResponse,
	releaseClaimedResponse,
} from '@/core/db/claimed-response';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	serverError,
	tooMany,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { getCachedResponse, readIdempotencyKey } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { berlinDayKey, endOfBerlinDay, startOfBerlinDay } from '@/core/utils/berlin-day';
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

const absenceCreateReplay = new ReplayCache<AbsenceCreateResponseBody>();

function isAbsenceCreateResponseBody(body: unknown): body is AbsenceCreateResponseBody {
	return body !== null && typeof body === 'object' && 'absence' in body;
}

function absenceCreateIdempotencyScope(wgId: string, memberId: string): string {
	return `absences-create:${wgId}:${memberId}`;
}

const createAbsenceSchema = z.object({
	memberId: z.string().uuid(),
	startDate: z.string().datetime({ offset: true }),
	endDate: z.string().datetime({ offset: true }),
	reason: z.string().trim().max(120).optional().nullable(),
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
	let replayReservation: Extract<
		ReplayReservation<AbsenceCreateResponseBody>,
		{ owned: true }
	> | null = null;
	let claimedLeaseExpiresAt: Date | null = null;
	let raw: unknown;
	try {
		raw = await readJsonLimited(req);
	} catch (err) {
		return unreadableJsonBody(err);
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
	if (endDate.getTime() < startDate.getTime()) return badRequest('date_range_invalid');
	if (berlinDayKey(endDate) < berlinDayKey(startDate)) return badRequest('date_range_invalid');
	const idemKey = readIdempotencyKey(req);
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const idemScope = idemKey ? absenceCreateIdempotencyScope(wg.id, auth.member.memberId) : null;
	const idemReplayKey = idemScope && idemKey ? replayKey(idemScope, idemKey) : null;
	if (idemScope && idemKey && idemReplayKey) {
		const localReplay = absenceCreateReplay.get(idemReplayKey);
		if (localReplay) return NextResponse.json(await localReplay);
		const cached = await getCachedResponse<AbsenceCreateResponseBody>(idemScope, idemKey);
		if (cached) {
			absenceCreateReplay.remember(idemReplayKey, cached);
			return NextResponse.json(cached);
		}
	}
	const limited = await checkRateLimit(wgWriteLimiter, `absence:${wg.id}:${auth.member.memberId}`);
	if (!limited.success) return tooMany();

	const member = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(
				eq(wgMembers.wgId, wg.id),
				eq(wgMembers.id, parsed.data.memberId),
				isNull(wgMembers.deactivatedAt),
			),
		)
		.limit(1);
	if (member.length === 0) return badRequest('member_not_in_wg');

	const denied = await requireOwnerOrAdmin(wg.id, auth.member, parsed.data.memberId);
	if (denied) return denied;

	const replaySlot = idemReplayKey === null ? null : absenceCreateReplay.reserve(idemReplayKey);
	if (replaySlot?.owned === false) return NextResponse.json(await replaySlot.promise);
	replayReservation = replaySlot;

	try {
		if (idemScope && idemKey) {
			const slot = await claimReplaySlotWithRetry<AbsenceCreateResponseBody>(idemScope, idemKey);
			if (!slot.won) {
				replayReservation?.resolve(slot.cached);
				return NextResponse.json(slot.cached);
			}
		}
		const creation = await withTransaction(async (tx) => {
			let lease: Date | null = null;
			if (idemScope && idemKey) {
				const claim = await lockClaimedResponse(
					tx,
					idemScope,
					idemKey,
					isAbsenceCreateResponseBody,
				);
				if (claim.kind === 'completed') return { kind: 'replayed' as const, body: claim.body };
				lease = claim.leaseExpiresAt;
				claimedLeaseExpiresAt = lease;
			}
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${`absence:${wg.id}:${parsed.data.memberId}`}))`,
			);
			const overlappingAbsence = await tx
				.select({ id: memberAbsences.id })
				.from(memberAbsences)
				.where(
					and(
						eq(memberAbsences.wgId, wg.id),
						eq(memberAbsences.memberId, parsed.data.memberId),
						lte(memberAbsences.startDate, endOfBerlinDay(endDate)),
						gte(memberAbsences.endDate, startOfBerlinDay(startDate)),
					),
				)
				.limit(1);
			if (overlappingAbsence.length > 0) return { kind: 'overlap' as const };
			const [created] = await tx
				.insert(memberAbsences)
				.values({
					wgId: wg.id,
					memberId: parsed.data.memberId,
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
			if (idemScope && idemKey && lease) {
				await completeClaimedResponse(tx, idemScope, idemKey, body, lease).catch((err: unknown) => {
					if (!(err instanceof TransactionAbort)) {
						logApiError('[absences POST] replay write failed', err);
					}
					throw new TransactionAbort('idempotency_response_write_failed');
				});
			}
			return { kind: 'created' as const, absence: created, body };
		});
		if (creation.kind === 'replayed') {
			replayReservation?.resolve(creation.body);
			return NextResponse.json(creation.body);
		}
		if (creation.kind === 'overlap') {
			const err = new Error('absence_overlaps_existing');
			replayReservation?.reject(err);
			if (idemScope && idemKey && claimedLeaseExpiresAt) {
				await releaseClaimedResponse(idemScope, idemKey, claimedLeaseExpiresAt);
			}
			return conflict('absence_overlaps_existing', 'absence_overlaps_existing');
		}
		const absence = creation.absence;
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
		replayReservation?.resolve(creation.body);
		return NextResponse.json(creation.body);
	} catch (err) {
		replayReservation?.reject(err);
		// Only the still-unfinished placeholder of this lease is removed, so this is
		// a no-op when the write committed before the failure.
		if (idemScope && idemKey && claimedLeaseExpiresAt) {
			await releaseClaimedResponse(idemScope, idemKey, claimedLeaseExpiresAt);
		}
		if (err instanceof TransactionAbort) {
			return serverError(err.code);
		}
		throw err;
	}
});

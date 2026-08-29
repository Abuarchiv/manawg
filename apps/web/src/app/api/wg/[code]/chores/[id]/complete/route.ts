import { recordAuditEvent } from '@/core/audit';
import { choreCompletions, chores, db, memberAbsences, wgMembers, wgs } from '@/core/db';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { badRequest, conflict, notFound, serverError, tooMany } from '@/core/errors';
import { UUID_PATTERN, requireMember } from '@/core/guards/api-auth';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { getCachedResponse, readIdempotencyKey, setCachedResponse } from '@/core/idempotency';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { getAbsentMemberIds } from '@/features/chores/absence';
import {
	chooseNextAvailableMember,
	computeOpenGapsByMember,
} from '@/features/chores/chore-fairness';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

type ChoreCompleteResponseBody = { chore: unknown };

const choreCompleteReplay = new ReplayCache<ChoreCompleteResponseBody>(IDEMPOTENCY_TTL_MS);

function choreCompleteIdempotencyScope(wgId: string, memberId: string, choreId: string): string {
	return `chores-complete:${wgId}:${memberId}:${choreId}`;
}

export const POST = withWgRoute<{ id: string }>(
	'chore complete POST',
	async (req, { code, id }) => {
		let replayReservation: Extract<
			ReplayReservation<ChoreCompleteResponseBody>,
			{ owned: true }
		> | null = null;
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const chore = await db
			.select({
				id: chores.id,
				wgId: chores.wgId,
				intervalDays: chores.intervalDays,
				recurrenceType: chores.recurrenceType,
				title: chores.title,
				assignedMemberId: chores.assignedMemberId,
				nextDueAt: chores.nextDueAt,
				anchorAt: chores.anchorAt,
			})
			.from(chores)
			.innerJoin(wgs, eq(wgs.id, chores.wgId))
			.where(and(eq(chores.id, id), eq(wgs.shareCode, code)))
			.limit(1);
		const c = chore[0];
		if (!c) return notFound('chore_not_found');

		const auth = await requireMember(req, c.wgId);
		if (!auth.ok) return auth.response;
		const idemKey = readIdempotencyKey(req);
		const idemScope = idemKey
			? choreCompleteIdempotencyScope(c.wgId, auth.member.memberId, c.id)
			: null;
		const idemReplayKey = idemScope && idemKey ? replayKey(idemScope, idemKey) : null;
		if (idemScope && idemKey && idemReplayKey) {
			const localReplay = choreCompleteReplay.get(idemReplayKey);
			if (localReplay) return NextResponse.json(await localReplay);
			const cached = await getCachedResponse<ChoreCompleteResponseBody>(idemScope, idemKey);
			if (cached) {
				choreCompleteReplay.remember(idemReplayKey, cached);
				return NextResponse.json(cached);
			}
		}
		const limited = await checkRateLimit(wgWriteLimiter, `chore:${c.wgId}:${auth.member.memberId}`);
		if (!limited.success) return tooMany();

		// SECURITY: completedBy is always the authenticated caller. Body fields
		// are ignored to prevent attribution spoofing.
		const completedBy = auth.member.memberId;
		const replaySlot = idemReplayKey === null ? null : choreCompleteReplay.reserve(idemReplayKey);
		if (replaySlot?.owned === false) return NextResponse.json(await replaySlot.promise);
		replayReservation = replaySlot;

		try {
			if (idemScope && idemKey) {
				const slot = await claimReplaySlotWithRetry<ChoreCompleteResponseBody>(idemScope, idemKey);
				if (!slot.won && slot.cached) {
					replayReservation?.resolve(slot.cached);
					return NextResponse.json(slot.cached);
				}
			}

			// Anchor next-due on the previous due (clamped to "now" if overdue) so
			// that early completions do not slide the cadence forward week-over-
			// week. See features/chores/chore-recurrence.ts.
			const completedAt = new Date();
			const nextDueAt = computeNextDueAt(
				c.nextDueAt,
				c.intervalDays,
				completedAt,
				c.recurrenceType,
				c.anchorAt,
			);
			// A late completion re-anchors the monthly cycle on completedAt;
			// otherwise keep the stored anchor (adopting nextDueAt for legacy rows).
			const late = completedAt.getTime() > c.nextDueAt.getTime();
			const effectiveAnchor = late ? completedAt : (c.anchorAt ?? c.nextDueAt);
			// Only active members join the rotation. A moved-out ("deactivated")
			// member is skipped, so the next chore never lands on someone who left.
			// Score-aware rotation: fetch WG chore snapshot (just the fields the
			// fairness ranker needs) so chooseNextAvailableMember matches what the
			// UI's "Nächste:r" hint shows. Without this snapshot, server falls back
			// to pure round-robin and silently disagrees with the UI prediction.
			const [members, absenceRows, wgChoresSnapshot] = await Promise.all([
				db
					.select({ id: wgMembers.id, name: wgMembers.name })
					.from(wgMembers)
					.where(and(eq(wgMembers.wgId, c.wgId), isNull(wgMembers.deactivatedAt)))
					.orderBy(wgMembers.createdAt),
				db
					.select({
						memberId: memberAbsences.memberId,
						startDate: memberAbsences.startDate,
						endDate: memberAbsences.endDate,
					})
					.from(memberAbsences)
					.where(eq(memberAbsences.wgId, c.wgId)),
				db
					.select({
						assignedMemberId: chores.assignedMemberId,
						nextDueAt: chores.nextDueAt,
					})
					.from(chores)
					.where(eq(chores.wgId, c.wgId)),
			]);
			const absentMemberIds = getAbsentMemberIds(
				absenceRows.map((absence) => ({
					memberId: absence.memberId,
					startDate: absence.startDate.toISOString(),
					endDate: absence.endDate.toISOString(),
				})),
			);
			// Reuse the same shared helper GET /chores uses so
			// openGapCountForAssignee here matches the UI's "Nächste:r" prediction
			// exactly instead of being hardcoded to 0.
			const openGapsByMember = computeOpenGapsByMember(
				wgChoresSnapshot.map((row) => ({
					assignedMemberId: row.assignedMemberId,
					nextDueAt: row.nextDueAt.toISOString(),
				})),
				completedAt.getTime(),
			);
			const nextAssigned = chooseNextAvailableMember({
				members,
				currentMemberId: c.assignedMemberId,
				absentMemberIds,
				chores: wgChoresSnapshot.map((row) => ({
					assignedMemberId: row.assignedMemberId,
					openGapCountForAssignee: row.assignedMemberId
						? (openGapsByMember.get(row.assignedMemberId) ?? 0)
						: 0,
					nextDueAt: row.nextDueAt.toISOString(),
				})),
			});

			// Race protection: double-click should not rotate the assignee twice. We
			// use optimistic concurrency on (previousAssignee, previousNextDueAt) —
			// only the click that observes the original snapshot succeeds. nextDueAt
			// is mutated on every successful completion and therefore also acts as a
			// version stamp for chores whose previous assignee was NULL (orphaned
			// chore after a member was deleted).
			//
			// The rotation UPDATE and the choreCompletions INSERT are one atomic
			// unit: chore-fairness.ts reads choreCompletions to count who did what,
			// so a rotation that commits without its completion row would silently
			// undercount that person forever. Losing the CAS race is a normal,
			// expected outcome (someone else's click already won) and still commits
			// as a no-op — only a genuine insert failure rolls the rotation back.
			const previousNextDueAt = c.nextDueAt;
			const assigneeMatch = c.assignedMemberId
				? eq(chores.assignedMemberId, c.assignedMemberId)
				: undefined;
			const guard = assigneeMatch
				? and(eq(chores.id, c.id), assigneeMatch, eq(chores.nextDueAt, previousNextDueAt))
				: and(eq(chores.id, c.id), eq(chores.nextDueAt, previousNextDueAt));
			// Reset lastReminderAt whenever assignee actually changes so the new
			// owner is not silently muted by the old assignee's 18h throttle. Keep
			// the stamp when assignee is unchanged (single-member WG) to avoid
			// double-firing reminders within the same day.
			const reminderReset = nextAssigned !== c.assignedMemberId ? { lastReminderAt: null } : {};

			let txResult: { raced: true } | { raced: false; chore: typeof chores.$inferSelect };
			try {
				txResult = await withTransaction(async (tx) => {
					const updatedRows = await tx
						.update(chores)
						.set({
							nextDueAt,
							assignedMemberId: nextAssigned,
							anchorAt: effectiveAnchor,
							...reminderReset,
						})
						.where(guard)
						.returning();
					const updated = updatedRows[0];
					if (!updated) {
						// Another concurrent completion already advanced the assignee.
						// Normal outcome — commit as a no-op rather than rotating again.
						return { raced: true as const };
					}

					const [completion] = await tx
						.insert(choreCompletions)
						.values({
							choreId: c.id,
							completedByMemberId: completedBy,
						})
						.returning({ id: choreCompletions.id });
					if (!completion) throw new TransactionAbort('completion_insert_failed');

					return { raced: false as const, chore: updated };
				});
			} catch (err) {
				if (err instanceof TransactionAbort) {
					replayReservation?.reject(err);
					console.error('[chore complete POST] completion insert failed', err);
					return serverError(err.code);
				}
				replayReservation?.reject(err);
				console.error('[chore complete POST] transaction failed', err);
				return serverError('completion_insert_failed');
			}

			if (txResult.raced) {
				const err = new Error('chore_already_completed');
				replayReservation?.reject(err);
				return conflict('chore_already_completed');
			}
			const updated = txResult.chore;

			await recordAuditEvent({
				wgId: c.wgId,
				memberId: completedBy,
				eventType: 'chore.completed',
				entityType: 'chore',
				entityId: c.id,
				summary: `${auth.member.name} hat ${c.title} erledigt.`,
				metadata: { nextAssignedMemberId: nextAssigned },
			});

			const responseBody = { chore: updated };
			if (idemScope && idemKey && replayReservation?.owned) {
				replayReservation.resolve(responseBody);
				void setCachedResponse(idemScope, idemKey, responseBody).catch((err) =>
					console.warn('[chore complete POST] idem cache write failed', err),
				);
			}
			return NextResponse.json(responseBody);
		} catch (err) {
			replayReservation?.reject(err);
			throw err;
		}
	},
);

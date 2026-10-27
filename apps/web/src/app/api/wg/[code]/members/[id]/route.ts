import { recordAuditEvent } from '@/core/audit';
import { db, pushSubscriptions, wgMembers, wgs } from '@/core/db';
import { lockActiveAccountMember } from '@/core/db/account-deletion';
import { releaseMemberChores } from '@/core/db/member-departure';
import { availableMemberName, releaseMemberName } from '@/core/db/member-names';
import { LIMITS } from '@/core/db/schema';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	rateLimitResponse,
	unauthorized,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { computeBalances } from '@/features/expenses/debts';
import {
	loadCompletedExpensePayments,
	withExpensePaymentLock,
} from '@/features/expenses/server/expense-payments';
import { loadOpenExpenses } from '@/features/expenses/server/open-expenses';
import { MAX_MEMBERS_PER_WG } from '@/shared/lib/limits';
import { and, count, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isUniqueMemberNameViolation } from '../unique-name-violation';

/** One open debt of the member being viewed, from their own perspective. */
interface OpenBalanceDto {
	member_id: string;
	name: string;
	amount_cents: number;
	currency: string;
	// 'owes'  → this member still owes the counterparty
	// 'owed'  → the counterparty still owes this member
	direction: 'owes' | 'owed';
}

/**
 * GET returns the member plus their open balances, so the "Auszug" (move-out)
 * confirmation can warn about money that would be left hanging. This does not
 * block anything — the decision is to allow the move-out and merely surface it.
 */
export const GET = withWgRoute<{ id: string }>('members/[id] GET', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const [target] = await db
		.select({
			id: wgMembers.id,
			name: wgMembers.name,
			deactivatedAt: wgMembers.deactivatedAt,
		})
		.from(wgMembers)
		.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wgId)))
		.limit(1);
	if (!target) return notFound('member_not_found');

	const [openExpenses, payments] = await Promise.all([
		loadOpenExpenses(wgId),
		loadCompletedExpensePayments(wgId),
	]);
	const balances = computeBalances(openExpenses, payments);
	const involved = balances.filter((b) => b.debtorId === id || b.creditorId === id);

	let openBalances: OpenBalanceDto[] = [];
	if (involved.length > 0) {
		const roster = await db
			.select({ id: wgMembers.id, name: wgMembers.name })
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wgId));
		const nameById = new Map(roster.map((row) => [row.id, row.name]));
		openBalances = involved.map((pair) =>
			pair.debtorId === id
				? {
						member_id: pair.creditorId,
						name: nameById.get(pair.creditorId) ?? 'Unbekannt',
						amount_cents: pair.amountCents,
						currency: pair.currency,
						direction: 'owes' as const,
					}
				: {
						member_id: pair.debtorId,
						name: nameById.get(pair.debtorId) ?? 'Unbekannt',
						amount_cents: pair.amountCents,
						currency: pair.currency,
						direction: 'owed' as const,
					},
		);
		openBalances.sort(
			(a, b) => a.currency.localeCompare(b.currency) || b.amount_cents - a.amount_cents,
		);
	}

	return NextResponse.json({
		member: {
			id: target.id,
			name: target.name,
			active: target.deactivatedAt === null,
		},
		openBalances,
	});
});

const patchSchema = z
	.object({
		active: z.boolean().optional(),
		name: z.string().trim().min(1).max(LIMITS.NAME_MAX).optional(),
		// The name the form was opened on; a different current name means someone renamed meanwhile.
		expectedName: z.string().trim().min(1).max(LIMITS.NAME_MAX).optional(),
	})
	.strict()
	.refine((value) => value.active !== undefined || value.name !== undefined);

/**
 * PATCH toggles a member between active and deactivated ("Auszug"). Deactivation
 * is a reversible soft-delete: it sets `deactivated_at` so the member drops out
 * of every active roster while all their history and balances stay intact.
 * `{ active: true }` clears the timestamp and brings them back (while the WG has
 * room). `{ name }` renames the member; the member themselves or an admin (active members only) may do that.
 * A moved-out member's name is freed for a new one; on return a taken name becomes a numbered one.
 */
export const PATCH = withWgRoute<{ id: string }>(
	'members/[id] PATCH',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const parsed = await parseBody(req, patchSchema, {
			invalid: 'active_invalid',
		});
		if (!parsed.ok) return parsed.response;
		const { active, name, expectedName } = parsed.data;
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `member-update:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		const result = await withExpensePaymentLock(wgId, async (tx) => {
			const actor = await lockActiveAccountMember(tx, wgId, auth.member.memberId, auth.authUserId);
			if (!actor) return { ok: false as const, response: unauthorized('member_deactivated') };
			const [target] = await tx
				.select({
					id: wgMembers.id,
					name: wgMembers.name,
					role: wgMembers.role,
					deactivatedAt: wgMembers.deactivatedAt,
				})
				.from(wgMembers)
				.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wgId)))
				.for('update');
			if (!target) return { ok: false as const, response: notFound('member_not_found') };

			const isOwner = actor.id === target.id;
			const isAdmin = actor.role === 'admin';
			if (active !== undefined && !isOwner && !isAdmin) {
				return { ok: false as const, response: forbidden('not_owner', 'not_owner') };
			}
			if (name !== undefined && !isOwner && !isAdmin) {
				return { ok: false as const, response: forbidden('not_owner', 'not_owner') };
			}
			// An admin renames active members only; a moved-out member keeps the name they left under.
			if (name !== undefined && target.deactivatedAt) {
				return {
					ok: false as const,
					response: conflict('member_deactivated', 'member_deactivated'),
				};
			}
			if (name !== undefined && expectedName !== undefined && target.name !== expectedName) {
				return { ok: false as const, response: conflict('name_changed', 'name_changed') };
			}
			if (active === false && target.role === 'admin') {
				return { ok: false as const, response: forbidden('admin_required', 'admin_required') };
			}

			let returnName: string | null = null;
			const activeChanged = active !== undefined && active !== (target.deactivatedAt === null);
			const nameChanged = name !== undefined && name !== target.name;
			if (!activeChanged && !nameChanged) {
				return {
					ok: true as const,
					changedActive: false,
					renamedFrom: null,
					renamedByOther: false,
					member: target,
				};
			}
			// Same row lock as a join, so a join/reactivation and a rename cannot race each other.
			if (nameChanged || (active === true && activeChanged)) {
				await tx.select({ id: wgs.id }).from(wgs).where(eq(wgs.id, wgId)).for('update');
			}
			if (nameChanged && !(await releaseMemberName(tx, wgId, name, id))) {
				return { ok: false as const, response: conflict('name_taken', 'name_taken') };
			}
			if (active === true && activeChanged) {
				const [activeCount] = await tx
					.select({ active: count() })
					.from(wgMembers)
					.where(and(eq(wgMembers.wgId, wgId), isNull(wgMembers.deactivatedAt)));
				if ((activeCount?.active ?? 0) >= MAX_MEMBERS_PER_WG) {
					return {
						ok: false as const,
						response: conflict('member_limit_reached', 'member_limit_reached'),
					};
				}
				// Someone may have taken the name meanwhile; this member then returns under a numbered one.
				if (!nameChanged && !(await releaseMemberName(tx, wgId, target.name, id))) {
					returnName = await availableMemberName(tx, wgId, target.name);
				}
			}

			const updateValues = {
				...(activeChanged ? { deactivatedAt: active ? null : new Date() } : {}),
				// A moved-out member keeps no push opt-in, same as account deletion.
				...(activeChanged && !active ? { pushOptIn: false } : {}),
				...(nameChanged ? { name } : {}),
				...(returnName ? { name: returnName } : {}),
			};
			let updated: Pick<typeof wgMembers.$inferSelect, 'id' | 'name' | 'deactivatedAt'> | undefined;
			try {
				// A savepoint keeps the transaction usable when the unique index catches a race.
				[updated] = await tx.transaction((savepoint) =>
					savepoint
						.update(wgMembers)
						.set(updateValues)
						.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wgId)))
						.returning({
							id: wgMembers.id,
							name: wgMembers.name,
							deactivatedAt: wgMembers.deactivatedAt,
						}),
				);
			} catch (updateErr) {
				if (isUniqueMemberNameViolation(updateErr)) {
					return { ok: false as const, response: conflict('name_taken', 'name_taken') };
				}
				throw updateErr;
			}
			if (!updated) return { ok: false as const, response: notFound('member_not_found') };
			// A moved-out member must not keep receiving pushes, and their browser
			// endpoint has to be free for the next WG on the same device.
			if (active === false) {
				await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.memberId, id));
				await releaseMemberChores(tx, wgId, id);
			}
			return {
				ok: true as const,
				changedActive: activeChanged,
				renamedFrom: nameChanged ? target.name : null,
				renamedByOther: !isOwner,
				member: updated,
			};
		});
		if (!result.ok) return result.response;
		if (result.changedActive) {
			await recordAuditEvent({
				wgId,
				memberId: auth.member.memberId,
				eventType: active ? 'member.reactivated' : 'member.deactivated',
				entityType: 'member',
				entityId: result.member.id,
				summary: active
					? `${auth.member.name} hat ${result.member.name} wieder aktiviert.`
					: `${auth.member.name} hat ${result.member.name} als ausgezogen markiert.`,
				metadata: { name: result.member.name },
			});
		}
		if (result.renamedFrom !== null) {
			await recordAuditEvent({
				wgId,
				memberId: auth.member.memberId,
				eventType: 'member.renamed',
				entityType: 'member',
				entityId: result.member.id,
				// A self-rename starts with the current name: the feed resolves the actor to it and
				// strips that prefix.
				summary: result.renamedByOther
					? `${auth.member.name} hat ${result.renamedFrom} in ${result.member.name} umbenannt.`
					: `${result.member.name} hat sich umbenannt (vorher ${result.renamedFrom}).`,
				metadata: { before: result.renamedFrom, after: result.member.name },
			});
		}
		return NextResponse.json({
			member: {
				id: result.member.id,
				name: result.member.name,
				active: result.member.deactivatedAt === null,
			},
		});
	},
);

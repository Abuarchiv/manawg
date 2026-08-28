import { UUID_PATTERN } from '@/lib/api-auth';
import { badRequest, forbidden, notFound, tooMany } from '@/lib/api-error';
import { db, wgMembers } from '@/lib/db';
import { checkRateLimit, wgWriteLimiter } from '@/lib/rate-limit';
import { isVerifiedWgAdmin } from '@/lib/wg/admin';
import { recordAuditEvent } from '@/lib/wg/audit';
import { computeBalances } from '@/lib/wg/debts';
import { loadOpenExpenses } from '@/lib/wg/open-expenses';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

/** One open debt of the member being viewed, from their own perspective. */
interface OpenBalanceDto {
	member_id: string;
	name: string;
	amount_cents: number;
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

	const balances = computeBalances(await loadOpenExpenses(wgId));
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
						direction: 'owes' as const,
					}
				: {
						member_id: pair.debtorId,
						name: nameById.get(pair.debtorId) ?? 'Unbekannt',
						amount_cents: pair.amountCents,
						direction: 'owed' as const,
					},
		);
		openBalances.sort((a, b) => b.amount_cents - a.amount_cents);
	}

	return NextResponse.json({
		member: { id: target.id, name: target.name, active: target.deactivatedAt === null },
		openBalances,
	});
});

const patchSchema = z.object({ active: z.boolean() });

/**
 * PATCH toggles a member between active and deactivated ("Auszug"). Deactivation
 * is a reversible soft-delete: it sets `deactivated_at` so the member drops out
 * of every active roster while all their history and balances stay intact.
 * `{ active: true }` clears the timestamp and brings them back.
 */
export const PATCH = withWgRoute<{ id: string }>(
	'members/[id] PATCH',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		let raw: unknown;
		try {
			raw = await req.json();
		} catch {
			return badRequest('invalid_json');
		}
		const parsed = patchSchema.safeParse(raw);
		if (!parsed.success) return badRequest('active_invalid');
		const { active } = parsed.data;
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const limited = await checkRateLimit(
			wgWriteLimiter,
			`member-status:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

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

		// Only the member themselves (leaving/returning) or a verified admin may
		// flip someone else's active status — matches the isOwner/isVerifiedWgAdmin
		// gate every other cross-member mutation uses (absences, events, chat,
		// recurring expenses, ...). A bare x-manawg-member-id is spoofable (any
		// current member can read every id via GET /members), so without this a
		// non-admin member could deactivate any flatmate, including the admin.
		// A bare x-manawg-member-id is spoofable (any member can read every id
		// via GET /members), so self-ownership only counts with a verified HMAC
		// token; admins need the verified gate anyway.
		const isOwner = auth.member.verified && id === auth.member.memberId;
		if (!isOwner && !(await isVerifiedWgAdmin(wgId, auth.member.memberId, auth.member.verified))) {
			return forbidden('not_owner', 'not_owner');
		}

		// Idempotent: if already in the requested state, report success without a
		// redundant write or audit entry.
		if (active === (target.deactivatedAt === null)) {
			return NextResponse.json({ member: { id: target.id, name: target.name, active } });
		}

		const [updated] = await db
			.update(wgMembers)
			.set({ deactivatedAt: active ? null : new Date() })
			.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wgId)))
			.returning({
				id: wgMembers.id,
				name: wgMembers.name,
				deactivatedAt: wgMembers.deactivatedAt,
			});
		if (!updated) return notFound('member_not_found');

		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: active ? 'member.reactivated' : 'member.deactivated',
			entityType: 'member',
			entityId: updated.id,
			summary: active
				? `${auth.member.name} hat ${updated.name} wieder aktiviert.`
				: `${auth.member.name} hat ${updated.name} als ausgezogen markiert.`,
			metadata: { name: updated.name },
		});

		return NextResponse.json({
			member: { id: updated.id, name: updated.name, active: updated.deactivatedAt === null },
		});
	},
);

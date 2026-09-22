import { recordAuditEvent } from '@/core/audit';
import { db, wgMembers } from '@/core/db';
import { badRequest, forbidden, notFound, requireVerifiedMember, tooMany } from '@/core/errors';
import { requireOwnerOrAdmin } from '@/core/guards/admin';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { computeBalances } from '@/features/expenses/debts';
import { loadCompletedExpensePayments } from '@/features/expenses/expense-payments';
import { loadOpenExpenses } from '@/features/expenses/open-expenses';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const PAYPAL_MERCHANT_ID_PATTERN = /^[2-9A-HJ-NP-Z]{13}$/;

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
			paypalMerchantId: wgMembers.paypalMerchantId,
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
			...(auth.member.memberId === target.id && auth.member.verified
				? { paypalMerchantId: target.paypalMerchantId }
				: {}),
		},
		openBalances,
	});
});

const patchSchema = z
	.object({
		active: z.boolean().optional(),
		paypalMerchantId: z
			.string()
			.trim()
			.toUpperCase()
			.regex(PAYPAL_MERCHANT_ID_PATTERN)
			.nullable()
			.optional(),
	})
	.refine((value) => value.active !== undefined || value.paypalMerchantId !== undefined);

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
		if (!parsed.success) {
			return badRequest(
				parsed.error.issues.some((issue) => issue.path[0] === 'paypalMerchantId')
					? 'paypal_merchant_id_invalid'
					: 'active_invalid',
			);
		}
		const { active, paypalMerchantId } = parsed.data;
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		if (paypalMerchantId !== undefined) {
			const verified = requireVerifiedMember(auth.member);
			if (verified) return verified;
			if (auth.member.memberId !== id) {
				return forbidden('paypal_merchant_id_owner_only', 'paypal_merchant_id_owner_only');
			}
		}

		const limited = await checkRateLimit(
			wgWriteLimiter,
			`member-update:${wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const [target] = await db
			.select({
				id: wgMembers.id,
				name: wgMembers.name,
				role: wgMembers.role,
				deactivatedAt: wgMembers.deactivatedAt,
				paypalMerchantId: wgMembers.paypalMerchantId,
			})
			.from(wgMembers)
			.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wgId)))
			.limit(1);
		if (!target) return notFound('member_not_found');

		// Only the member themselves (leaving/returning) or a verified admin may
		// flip someone else's active status — matches the owner/admin gate every
		// other cross-member mutation uses (absences, events, chat, recurring
		// expenses, ...). A bare x-manawg-member-id is spoofable (any current
		// member can read every id via GET /members), so without this a non-admin
		// member could deactivate any flatmate, including the admin.
		if (active !== undefined) {
			const denied = await requireOwnerOrAdmin(wgId, auth.member, id);
			if (denied) return denied;
		}
		if (active === false && target.role === 'admin') {
			return forbidden('admin_required', 'admin_required');
		}

		// Idempotent: if already in the requested state, report success without a
		// redundant write or audit entry.
		const activeUnchanged = active === undefined || active === (target.deactivatedAt === null);
		const paypalUnchanged =
			paypalMerchantId === undefined || paypalMerchantId === (target.paypalMerchantId ?? null);
		if (activeUnchanged && paypalUnchanged) {
			return NextResponse.json({
				member: {
					id: target.id,
					name: target.name,
					active: target.deactivatedAt === null,
					...(auth.member.memberId === target.id && auth.member.verified
						? { paypalMerchantId: target.paypalMerchantId }
						: {}),
				},
			});
		}

		const updateValues = {
			...(active !== undefined ? { deactivatedAt: active ? null : new Date() } : {}),
			...(paypalMerchantId !== undefined ? { paypalMerchantId } : {}),
		};
		const [updated] = await db
			.update(wgMembers)
			.set(updateValues)
			.where(and(eq(wgMembers.id, id), eq(wgMembers.wgId, wgId)))
			.returning({
				id: wgMembers.id,
				name: wgMembers.name,
				deactivatedAt: wgMembers.deactivatedAt,
				paypalMerchantId: wgMembers.paypalMerchantId,
			});
		if (!updated) return notFound('member_not_found');

		if (active !== undefined && active !== (target.deactivatedAt === null)) {
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
		}

		return NextResponse.json({
			member: {
				id: updated.id,
				name: updated.name,
				active: updated.deactivatedAt === null,
				...(auth.member.memberId === updated.id && auth.member.verified
					? { paypalMerchantId: updated.paypalMerchantId }
					: {}),
			},
		});
	},
);

import { recordAuditEvent } from '@/core/audit';
import { db, wgMembers, wgs } from '@/core/db';
import { lockActiveAccountMember } from '@/core/db/account-deletion';
import { deleteWgCascade } from '@/core/db/delete-wg';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireWgAdmin } from '@/core/guards/require-wg-admin';
import { requireWgMembership } from '@/core/guards/require-wg-member';
import { readShareCode } from '@/core/guards/route-preamble';
import { conflict, forbidden, notFound, serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { withExpensePaymentLock } from '@/features/expenses/server/expense-payments';
import { WG_NAME_MAX_LENGTH } from '@/shared/lib/limits';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const WG_NAME_MIN = 1;

const patchWgSchema = z.object({
	name: z.string().trim().min(WG_NAME_MIN).max(WG_NAME_MAX_LENGTH),
});

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;

	try {
		const auth = await requireWgMembership(req, code, 'api/wg/[code] GET', (shareCode) =>
			db.query.wgs.findFirst({
				where: (w, { eq }) => eq(w.shareCode, shareCode),
				columns: {
					id: true,
					name: true,
					shareCode: true,
					createdAt: true,
				},
			}),
		);
		if (!auth.ok) return auth.response;
		const { wg } = auth;

		const members = await db
			.select({ id: wgMembers.id, name: wgMembers.name, color: wgMembers.color })
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wg.id));
		return NextResponse.json({
			wg,
			members,
			currentMember: {
				memberId: auth.member.memberId,
				name: auth.member.name,
				authUserId: auth.authUserId,
			},
		});
	} catch (err) {
		logApiError('[api/wg/[code] GET] failed', err);
		return serverError('db_error');
	}
}

export async function PATCH(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;
	const parsed = await parseBody(req, patchWgSchema, { invalid: 'wg_update_invalid' });
	if (!parsed.ok) return parsed.response;
	const { name } = parsed.data;

	try {
		const admin = await requireWgAdmin(req, code, 'wg-settings');
		if (!admin.ok) return admin.response;
		const { wg, member } = admin;
		const result = await withTransaction(async (tx) => {
			const actor = await lockActiveAccountMember(tx, wg.id, member.memberId, admin.authUserId);
			if (!actor || actor.role !== 'admin') {
				return { ok: false as const, response: forbidden('not_admin', 'not_admin') };
			}
			const [currentWg] = await tx
				.select({ name: wgs.name })
				.from(wgs)
				.where(eq(wgs.id, wg.id))
				.for('update');
			if (!currentWg) return { ok: false as const, response: notFound('wg_not_found') };
			const [updated] = await tx
				.update(wgs)
				.set({ name, updatedAt: new Date() })
				.where(eq(wgs.id, wg.id))
				.returning();
			if (!updated) return { ok: false as const, response: notFound('wg_not_found') };
			return { ok: true as const, currentWg, updated };
		});
		if (!result.ok) return result.response;
		await recordAuditEvent({
			wgId: wg.id,
			memberId: member.memberId,
			eventType: 'wg.updated',
			entityType: 'wg',
			entityId: wg.id,
			summary: `${member.name} hat die WG-Einstellungen geändert.`,
			metadata: { nameBefore: result.currentWg.name, nameAfter: result.updated.name },
		});
		return NextResponse.json({ wg: result.updated });
	} catch (err) {
		logApiError('[api/wg/[code] PATCH] failed', err);
		return serverError('db_error');
	}
}

export async function DELETE(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;
	try {
		const admin = await requireWgAdmin(req, code, 'wg-settings');
		if (!admin.ok) return admin.response;
		const { wg, member } = admin;
		const result = await withExpensePaymentLock(wg.id, async (tx) => {
			const actor = await lockActiveAccountMember(tx, wg.id, member.memberId, admin.authUserId);
			if (!actor || actor.role !== 'admin') {
				return { ok: false as const, reason: 'not_admin' as const };
			}
			return { ok: true as const, deleted: await deleteWgCascade(tx, wg.id) };
		});
		if (!result.ok) return forbidden('not_admin', 'not_admin');
		if (!result.deleted) return notFound('wg_not_found');
		return NextResponse.json({ deleted: true });
	} catch (err) {
		if (err instanceof TransactionAbort && err.code === 'paypal_payment_pending') {
			return conflict('paypal_payment_pending');
		}
		logApiError('[api/wg/[code] DELETE] failed', err);
		return serverError('db_error');
	}
}

import { recordAuditEvent } from '@/core/audit';
import {
	announcements,
	chores,
	db,
	expensePayments,
	expenses,
	recurringExpenses,
	shoppingItems,
	wgMembers,
	wgs,
} from '@/core/db';
import { withTransaction } from '@/core/db/transaction';
import { badRequest, notFound, serverError } from '@/core/errors';
import { requireMember } from '@/core/guards/api-auth';
import { deriveMemberToken } from '@/core/guards/member-token';
import { requireWgAdmin } from '@/core/guards/require-wg-admin';
import { readShareCode } from '@/core/guards/route-preamble';
import type { RouteCtx } from '@/core/infra/api-types';
import { getE2EWgFixture, isE2EDbDownMode } from '@/core/infra/e2e-db-down';
import { logApiError } from '@/core/infra/observability';
import { generateShareCode } from '@/shared/lib/share-code';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const WG_NAME_MIN = 1;
const WG_NAME_MAX = 100;

const patchWgSchema = z
	.object({
		name: z.string().trim().min(WG_NAME_MIN).max(WG_NAME_MAX).optional(),
		joiningEnabled: z.boolean().optional(),
		rotateShareCode: z.boolean().optional(),
	})
	.refine(
		(value) =>
			value.name !== undefined ||
			value.joiningEnabled !== undefined ||
			value.rotateShareCode === true,
		{ message: 'empty_update' },
	);

async function generateUniqueShareCode(): Promise<string> {
	for (let attempt = 0; attempt < 8; attempt++) {
		const shareCode = generateShareCode();
		const existing = await db.query.wgs.findFirst({
			where: (w, { eq }) => eq(w.shareCode, shareCode),
			columns: { id: true },
		});
		if (!existing) return shareCode;
	}
	throw new Error('share_code_generation_failed');
}

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;

	if (isE2EDbDownMode()) {
		const fixture = getE2EWgFixture(code);
		if (!fixture) return notFound('wg_not_found');
		return NextResponse.json({
			wg: {
				id: fixture.id,
				name: fixture.name,
				shareCode: fixture.shareCode,
				joiningEnabled: fixture.joiningEnabled,
				shareCodeRotatedAt: fixture.shareCodeRotatedAt,
				createdAt: new Date().toISOString(),
			},
			members: fixture.members,
			...(fixture.members[0]
				? {
						currentMember: {
							memberId: fixture.members[0].id,
							name: fixture.members[0].name,
						},
					}
				: {}),
		});
	}

	try {
		const wg = await db.query.wgs.findFirst({
			where: (w, { eq }) => eq(w.shareCode, code),
			columns: {
				id: true,
				name: true,
				shareCode: true,
				joiningEnabled: true,
				shareCodeRotatedAt: true,
				createdAt: true,
			},
		});
		if (!wg) {
			return notFound('wg_not_found');
		}
		const auth = await requireMember(req, wg.id);
		if (!auth.ok) return auth.response;
		const memberToken = deriveMemberToken(wg.id, auth.member.memberId);

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
				...(memberToken ? { memberToken } : {}),
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

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = patchWgSchema.safeParse(raw);
	if (!parsed.success) {
		return badRequest('wg_update_invalid');
	}

	const { name, joiningEnabled, rotateShareCode } = parsed.data;

	try {
		const admin = await requireWgAdmin(req, code, 'wg-settings');
		if (!admin.ok) return admin.response;
		const { wg, member } = admin;

		const updates: {
			name?: string;
			joiningEnabled?: boolean;
			shareCode?: string;
			shareCodeRotatedAt?: Date;
			updatedAt: Date;
		} = { updatedAt: new Date() };
		if (name !== undefined) updates.name = name;
		if (joiningEnabled !== undefined) updates.joiningEnabled = joiningEnabled;
		if (rotateShareCode) {
			updates.shareCode = await generateUniqueShareCode();
			updates.shareCodeRotatedAt = new Date();
			updates.joiningEnabled = true;
		}

		const [updated] = await db.update(wgs).set(updates).where(eq(wgs.id, wg.id)).returning();
		if (!updated) {
			return notFound('wg_not_found');
		}
		await recordAuditEvent({
			wgId: wg.id,
			memberId: member.memberId,
			eventType: rotateShareCode
				? 'wg.share_code_rotated'
				: joiningEnabled !== undefined && name === undefined
					? 'wg.joining_updated'
					: 'wg.updated',
			entityType: 'wg',
			entityId: wg.id,
			summary: rotateShareCode
				? `${member.name} hat den WG-Code rotiert.`
				: joiningEnabled !== undefined && wg.joiningEnabled !== joiningEnabled
					? `${member.name} hat Beitritte ${joiningEnabled ? 'geöffnet' : 'gesperrt'}.`
					: `${member.name} hat die WG-Einstellungen geändert.`,
			metadata: {
				nameBefore: wg.name,
				nameAfter: updated.name,
				joiningEnabledBefore: wg.joiningEnabled,
				joiningEnabledAfter: updated.joiningEnabled,
				shareCodeRotated: Boolean(rotateShareCode),
			},
		});
		return NextResponse.json({ wg: updated });
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

		await recordAuditEvent({
			wgId: wg.id,
			memberId: member.memberId,
			eventType: 'wg.deleted',
			entityType: 'wg',
			entityId: wg.id,
			summary: `${member.name} hat die WG gelöscht.`,
			metadata: { name: wg.name },
		});

		const result = await withTransaction(async (tx) => {
			// Several historical/member references intentionally use RESTRICT so a
			// member cannot be hard-deleted while its accounting history remains.
			// Whole-WG deletion is the explicit destructive operation, so remove
			// those WG-owned roots in one transaction and let the remaining WG
			// cascades clean up comments, splits, logs, and subscriptions.
			await tx.delete(expenses).where(eq(expenses.wgId, wg.id));
			await tx.delete(expensePayments).where(eq(expensePayments.wgId, wg.id));
			await tx.delete(shoppingItems).where(eq(shoppingItems.wgId, wg.id));
			await tx.delete(announcements).where(eq(announcements.wgId, wg.id));
			await tx.delete(chores).where(eq(chores.wgId, wg.id));
			await tx.delete(recurringExpenses).where(eq(recurringExpenses.wgId, wg.id));
			return tx.delete(wgs).where(eq(wgs.id, wg.id)).returning({ id: wgs.id });
		});
		if (result.length === 0) {
			return notFound('wg_not_found');
		}
		return NextResponse.json({ deleted: true });
	} catch (err) {
		logApiError('[api/wg/[code] DELETE] failed', err);
		return serverError('db_error');
	}
}

import { recordAuditEvent } from '@/core/audit';
import { getAuthenticatedUser } from '@/core/auth/server';
import { db, wgMembers, wgs } from '@/core/db';
import { LIMITS } from '@/core/db/schema';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { apiError, badRequest, serverError, tooMany } from '@/core/errors';
import { deriveMemberToken } from '@/core/guards/member-token';
import { E2E_CREATED_WG, isE2EDbDownMode } from '@/core/infra/e2e-db-down';
import { checkRateLimit, clientIpKey, rateLimitFailMode, registerLimiter } from '@/core/rate-limit';
import { generateShareCode, isValidShareCode } from '@/shared/lib/share-code';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const WG_NAME_MIN = 1;
const WG_NAME_MAX = 100;
const SHARE_CODE_RETRIES = 5;

const createWgSchema = z.object({
	name: z.string().trim().min(WG_NAME_MIN).max(WG_NAME_MAX),
	creatorName: z.string().trim().min(WG_NAME_MIN).max(LIMITS.NAME_MAX),
});

function isUniqueShareCodeViolation(err: unknown): boolean {
	return (
		!!err &&
		typeof err === 'object' &&
		'code' in err &&
		(err as { code?: unknown }).code === '23505'
	);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
	// Defense in depth: middleware already covers /api/wg with wgWriteLimiter
	// (30/min/IP). WG creation is rarer than other writes, so apply the
	// stricter registerLimiter (3/hour/IP) on top to block WG spam.
	const ip = clientIpKey(req);
	// Local/CI dev servers have no Upstash service and must still exercise the
	// real DB flow; fail-closed deployments reject missing limiter state.
	const limit = await checkRateLimit(registerLimiter, ip, rateLimitFailMode());
	if (!limit.success) {
		if (limit.limiterUnavailable) {
			const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
			return NextResponse.json(
				{ error: 'rate_limiter_unavailable', retryAfterMs: Math.max(0, limit.reset - Date.now()) },
				{
					status: 503,
					headers: {
						'Retry-After': retryAfter.toString(),
					},
				},
			);
		}
		return tooMany('rate_limited', 'wg_create_rate_limited');
	}

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = createWgSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.name) return badRequest('name_invalid');
		if (fieldErrors.creatorName) return badRequest('creator_name_invalid');
		return badRequest('invalid_body');
	}

	const { name, creatorName } = parsed.data;

	if (isE2EDbDownMode()) {
		return NextResponse.json({
			wg: {
				id: E2E_CREATED_WG.id,
				shareCode: E2E_CREATED_WG.shareCode,
				name,
			},
			creator: {
				id: E2E_CREATED_WG.member.id,
				name: creatorName,
				token: deriveMemberToken(E2E_CREATED_WG.id, E2E_CREATED_WG.member.id),
			},
		});
	}

	let user: { id: string } | null;
	try {
		user = await getAuthenticatedUser(req);
	} catch (err) {
		console.error('[api/wg POST] auth lookup failed', err);
		return serverError('auth_unavailable');
	}
	if (!user) return apiError('auth_required', 401, 'auth_required');

	let shareCode = '';
	for (let attempt = 0; attempt < SHARE_CODE_RETRIES; attempt += 1) {
		const candidate = generateShareCode();
		if (!isValidShareCode(candidate)) continue;
		const existing = await db.query.wgs.findFirst({
			where: (w, { eq }) => eq(w.shareCode, candidate),
			columns: { id: true },
		});
		if (!existing) {
			shareCode = candidate;
			break;
		}
	}
	if (!shareCode) {
		return serverError('share_code_exhausted');
	}

	try {
		// The WG and its creator are one write. A WG whose creator row is missing
		// has a valid share code but no one who can administer it, and the person
		// who just created it is not a member of it. This used to be repaired
		// with a delete afterwards, which only covered the case of an insert
		// returning no row — when the insert threw instead, nothing cleaned up
		// and the empty WG stayed.
		//
		// The share-code uniqueness check happens before the transaction, so the
		// 23505 on the unique index can still fire inside it — retry with a fresh
		// code instead of surfacing a raw db_error to a double-clicking user.
		let lastError: unknown = null;
		for (let attempt = 0; attempt < SHARE_CODE_RETRIES; attempt += 1) {
			if (attempt > 0) {
				const candidate = generateShareCode();
				if (!isValidShareCode(candidate)) continue;
				shareCode = candidate;
			}
			try {
				const { wg, member } = await withTransaction(async (tx) => {
					const [createdWg] = await tx.insert(wgs).values({ name, shareCode }).returning();
					if (!createdWg) throw new TransactionAbort('insert_failed');

					const [createdMember] = await tx
						.insert(wgMembers)
						.values({
							wgId: createdWg.id,
							name: creatorName,
							role: 'admin',
							authUserId: user.id,
						})
						.returning();
					if (!createdMember) throw new TransactionAbort('member_insert_failed');

					return { wg: createdWg, member: createdMember };
				});

				await recordAuditEvent({
					wgId: wg.id,
					memberId: member.id,
					eventType: 'wg.created',
					entityType: 'wg',
					entityId: wg.id,
					summary: `${member.name} hat die WG erstellt.`,
					metadata: { name: wg.name, shareCode: wg.shareCode },
				});

				return NextResponse.json({
					wg: {
						id: wg.id,
						shareCode: wg.shareCode,
						name: wg.name,
					},
					creator: {
						id: member.id,
						name: member.name,
					},
				});
			} catch (err) {
				if (err instanceof TransactionAbort) return serverError(err.code);
				lastError = err;
				if (!isUniqueShareCodeViolation(err)) throw err;
			}
		}
		console.error('[api/wg POST] share code retries exhausted', lastError);
		return serverError('share_code_exhausted');
	} catch (err) {
		console.error('[api/wg POST] insert failed', err);
		return serverError('db_error');
	}
}

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, wgMembers, wgs } from '@/core/db';
import { assertAccountCanAcquireMembership } from '@/core/db/account-deletion';
import {
	responseCodec,
	type WriteFn,
	type WriteOutcome,
	withIdempotentWrite,
} from '@/core/db/idempotent-write';
import { isUniqueViolation } from '@/core/db/pg-errors';
import { LIMITS } from '@/core/db/schema';
import { TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireAccount } from '@/core/guards/require-account';
import { conflict, rateLimitResponse, serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { requestLocale } from '@/core/i18n/request-locale';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { inheritedMailPrefs } from '@/core/mail/unsubscribe';
import { checkRateLimit, clientIpKey, rateLimitFailMode, registerLimiter } from '@/core/rate-limit';
import { generateShareCode, isValidShareCode } from '@/core/utils/share-code';
import { WG_NAME_MAX_LENGTH } from '@/shared/lib/limits';

const WG_NAME_MIN = 1;
const SHARE_CODE_RETRIES = 5;

const wgCreateCodec = responseCodec();

const createWgSchema = z.object({
	name: z.string().trim().min(WG_NAME_MIN).max(WG_NAME_MAX_LENGTH),
	creatorName: z.string().trim().min(WG_NAME_MIN).max(LIMITS.NAME_MAX),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
	const parsed = await parseBody(req, createWgSchema, {
		fieldErrors: { name: 'name_invalid', creatorName: 'creator_name_invalid' },
	});
	if (!parsed.ok) return parsed.response;
	const { name, creatorName } = parsed.data;

	const account = await requireAccount(req, 'api/wg POST');
	if (!account.ok) return account.response;
	const authUserId = account.user.id;
	const locale = requestLocale(req);

	// Defense in depth: middleware already covers /api/wg with wgWriteLimiter
	// (60/min per session, 150/min per IP backstop). WG creation is rarer than other writes, so
	// apply the stricter registerLimiter (10/hour/IP) on top to block WG spam. It runs after body
	// validation and auth so rejected attempts (400/401/auth outage) cost no budget.
	// Known limit: idempotent replays and 5xx retries count too; the key is not known before the write.
	const ip = clientIpKey(req);
	// Local/CI dev servers have no Upstash service and must still exercise the
	// real DB flow; fail-closed deployments reject missing limiter state.
	const limit = await checkRateLimit(registerLimiter, ip, rateLimitFailMode());
	const limited = rateLimitResponse(limit, 'rate_limited', 'wg_create_rate_limited');
	if (limited) return limited;
	const accountDeletionReplayResponse = async () => {
		try {
			await withTransaction((tx) => assertAccountCanAcquireMembership(tx, authUserId));
			return null;
		} catch (err) {
			if (err instanceof TransactionAbort && err.code === 'account_deletion_pending') {
				return conflict('account_deletion_pending', 'account_deletion_pending');
			}
			logApiError('[api/wg POST] replay fence check failed', err);
			return serverError('db_error');
		}
	};

	// The share-code uniqueness check runs before the transaction, so the unique index can still
	// fire inside it; the write then retries with a fresh code instead of failing a double click.
	let shareCode = '';
	type Created = { wgId: string; memberId: string; memberName: string; wgName: string };
	const createWg: WriteFn<WriteOutcome<unknown, Created>, undefined> = async (tx) => {
		// The WG and its creator are one write: a WG without its creator has a valid share code
		// but nobody who can administer it.
		const [createdWg] = await tx.insert(wgs).values({ name, shareCode }).returning();
		if (!createdWg) throw new TransactionAbort('insert_failed');
		const [createdMember] = await tx
			.insert(wgMembers)
			.values({
				wgId: createdWg.id,
				name: creatorName,
				role: 'admin',
				authUserId,
				locale,
				...inheritedMailPrefs(authUserId),
			})
			.returning();
		if (!createdMember) throw new TransactionAbort('member_insert_failed');
		return {
			status: 200,
			body: {
				wg: { id: createdWg.id, shareCode: createdWg.shareCode, name: createdWg.name },
				creator: { id: createdMember.id, name: createdMember.name },
			},
			context: {
				wgId: createdWg.id,
				memberId: createdMember.id,
				memberName: createdMember.name,
				wgName: createdWg.name,
			},
		};
	};

	try {
		const result = await withIdempotentWrite(
			{
				scope: `wg-create:${authUserId}`,
				key: readIdempotencyKey(req),
				codec: wgCreateCodec,
				beforeReplay: accountDeletionReplayResponse,
				prepare: async () => {
					shareCode = await findFreeShareCode();
					return shareCode ? { input: undefined } : { stop: serverError('share_code_exhausted') };
				},
				inTransaction: (work) =>
					withTransaction(async (tx) => {
						await assertAccountCanAcquireMembership(tx, authUserId);
						return work(tx);
					}),
				retryAfterRollback: (err, attempt) => {
					if (!isUniqueViolation(err) || attempt >= SHARE_CODE_RETRIES) return null;
					const candidate = generateShareCode();
					if (isValidShareCode(candidate)) shareCode = candidate;
					return createWg;
				},
			},
			createWg,
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'replayed' || !result.context) {
			return NextResponse.json(result.body, { status: result.status });
		}
		const created = result.context;
		await recordAuditEvent({
			wgId: created.wgId,
			memberId: created.memberId,
			eventType: 'wg.created',
			entityType: 'wg',
			entityId: created.wgId,
			actorName: created.memberName,
			metadata: { name: created.wgName, shareCode },
		});
		return NextResponse.json(result.body, { status: result.status });
	} catch (err) {
		if (err instanceof TransactionAbort) {
			if (err.code === 'account_deletion_pending') {
				return conflict('account_deletion_pending', 'account_deletion_pending');
			}
			return serverError(err.code);
		}
		if (isUniqueViolation(err)) {
			logApiError('[api/wg POST] share code retries exhausted', err);
			return serverError('share_code_exhausted');
		}
		if (err instanceof Error && err.message.startsWith('idempotency_')) return serverError(err);
		logApiError('[api/wg POST] insert failed', err);
		return serverError('db_error');
	}
}

async function findFreeShareCode(): Promise<string> {
	for (let attempt = 0; attempt < SHARE_CODE_RETRIES; attempt += 1) {
		const candidate = generateShareCode();
		if (!isValidShareCode(candidate)) continue;
		const existing = await db.query.wgs.findFirst({
			where: (w, { eq }) => eq(w.shareCode, candidate),
			columns: { id: true },
		});
		if (!existing) return candidate;
	}
	return '';
}

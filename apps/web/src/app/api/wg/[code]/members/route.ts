import { and, asc, count, eq, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, wgInvites, wgMembers, wgs } from '@/core/db';
import { assertAccountCanAcquireMembership } from '@/core/db/account-deletion';
import { responseCodec, type WriteOutcome, withIdempotentWrite } from '@/core/db/idempotent-write';
import { releaseMemberName } from '@/core/db/member-names';
import { LIMITS } from '@/core/db/schema';
import { type DbTransaction, TransactionAbort, withTransaction } from '@/core/db/transaction';
import { inviteStatus } from '@/core/db/wg-invites';
import { isWgAdmin } from '@/core/guards/admin';
import { requireAccount } from '@/core/guards/require-account';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { shareCodeMissResponse } from '@/core/guards/share-code-miss';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	apiError,
	conflict,
	forbidden,
	HTTP,
	notFound,
	rateLimitResponse,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkRateLimit, clientIpKey, wgWriteLimiter } from '@/core/rate-limit';
import { isInviteToken } from '@/core/utils/invite-token';
import { MAX_MEMBERS_PER_WG } from '@/shared/lib/limits';
import { isUniqueMemberNameViolation } from './unique-name-violation';

// GET pagination: the listing must never degenerate into an unbounded SELECT.
// Moved-out rows are never deleted, so joins stop at MAX_MEMBER_ROWS_PER_WG rows
// in total; the default page covers that, so clients that send no limit always
// receive the full roster (payer/split pickers would silently drop people otherwise).
const MAX_MEMBER_ROWS_PER_WG = 500;
const MEMBERS_PAGE_LIMIT_DEFAULT = MAX_MEMBER_ROWS_PER_WG;
const MEMBERS_PAGE_LIMIT_MAX = MAX_MEMBER_ROWS_PER_WG;

function readPageParams(req: NextRequest): { limit: number; offset: number } {
	const params = req.nextUrl.searchParams;
	const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);
	const rawOffset = Number.parseInt(params.get('offset') ?? '', 10);
	const limit = Number.isFinite(rawLimit)
		? Math.min(Math.max(rawLimit, 1), MEMBERS_PAGE_LIMIT_MAX)
		: MEMBERS_PAGE_LIMIT_DEFAULT;
	const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
	return { limit, offset };
}

export const GET = withWgRoute('members GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	// Display-only listing for every member of the WG, including deactivated
	// ("moved-out") ones — they still need to resolve names/balances in
	// history, and choice UIs (identity picker, split/payer dropdowns, chore
	// rotation) filter on the `active` flag instead of the server dropping
	// rows here.
	const { limit, offset } = readPageParams(req);
	const [rows, totalRows] = await Promise.all([
		db
			.select({
				id: wgMembers.id,
				name: wgMembers.name,
				color: wgMembers.color,
				deactivatedAt: wgMembers.deactivatedAt,
				role: wgMembers.role,
				authUserId: wgMembers.authUserId,
			})
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wgId))
			.orderBy(asc(wgMembers.createdAt), asc(wgMembers.id))
			.limit(limit)
			.offset(offset),
		db.select({ total: count() }).from(wgMembers).where(eq(wgMembers.wgId, wgId)),
	]);

	// Role and account link are exposed as flags only; ids of accounts stay server-side.
	const members = rows.map(({ deactivatedAt, role, authUserId, ...member }) => ({
		...member,
		active: deactivatedAt === null,
		isAdmin: role === 'admin' && deactivatedAt === null,
		hasAccount: authUserId !== null,
	}));
	// Client-side UI gating only (deactivate/reactivate buttons, chat
	// admin-delete) — every actual mutation re-checks the admin role
	// server-side, so a stale value here can't grant real access.
	const viewerIsAdmin = await isWgAdmin(wgId, auth.member.memberId);

	return NextResponse.json({
		members,
		viewerIsAdmin,
		pagination: { total: totalRows[0]?.total ?? 0, limit, offset },
	});
});

const joinMemberSchema = z.object({
	name: z.string().trim().min(1).max(LIMITS.NAME_MAX),
	color: z.string().trim().max(16).nullish(),
	inviteToken: z.string().trim().max(64).optional(),
});

type JoinRejection =
	| 'limit'
	| 'name_taken'
	| 'already_joined'
	| 'member_deactivated'
	| 'not_found'
	| 'invite_required'
	| 'invite_expired';

const joinCodec = responseCodec();

function joinRejectionResponse(reason: JoinRejection): NextResponse {
	if (reason === 'not_found') return notFound('wg_not_found');
	if (reason === 'invite_required') return forbidden('invite_required', 'invite_required');
	if (reason === 'invite_expired') return apiError('invite_expired', HTTP.GONE, 'invite_expired');
	if (reason === 'limit') return conflict('member_limit_reached', 'member_limit_reached');
	if (reason === 'member_deactivated') return forbidden('member_deactivated', 'member_deactivated');
	if (reason === 'already_joined') return conflict('already_joined', 'already_joined');
	return conflict('name_taken', 'name_taken');
}

/**
 * An invitation token is the only way in; the share code is just the WG's address. The per-WG
 * member cap and unique names keep a leaked link from flooding the WG; token check, count check
 * and insert run behind a row lock on the WG, because two concurrent joins would otherwise both
 * pass the cap and use-count checks.
 */
async function insertJoiningMember(
	tx: DbTransaction,
	input: {
		wgId: string;
		code: string;
		authUserId: string;
		name: string;
		color: string | null;
		inviteToken: string;
	},
): Promise<
	WriteOutcome<
		unknown,
		{ member: typeof wgMembers.$inferSelect; inviteId: string } | { reason: JoinRejection }
	>
> {
	const reject = (reason: JoinRejection) => ({
		status: HTTP.CONFLICT,
		body: null,
		context: { reason },
	});
	await assertAccountCanAcquireMembership(tx, input.authUserId);
	const [lockedWg] = await tx
		.select({ shareCode: wgs.shareCode })
		.from(wgs)
		.where(eq(wgs.id, input.wgId))
		.for('update');
	if (!lockedWg || lockedWg.shareCode !== input.code) return reject('not_found');
	const existingForUser = await tx
		.select({ id: wgMembers.id, deactivatedAt: wgMembers.deactivatedAt })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, input.wgId), eq(wgMembers.authUserId, input.authUserId)))
		.limit(1);
	// A moved-out member must not be sent into the WG (it would bounce them back to the
	// picker); an admin has to reactivate them.
	if (existingForUser[0]?.deactivatedAt) return reject('member_deactivated');
	if (existingForUser.length > 0) return reject('already_joined');
	if (!isInviteToken(input.inviteToken)) return reject('invite_required');
	const [invite] = await tx
		.select()
		.from(wgInvites)
		.where(and(eq(wgInvites.token, input.inviteToken), eq(wgInvites.wgId, input.wgId)))
		.for('update');
	if (!invite) return reject('invite_required');
	if (inviteStatus(invite) !== 'valid') return reject('invite_expired');
	// The cap counts active members only (moved-out rows are soft-deleted and never removed),
	// plus a hard ceiling on all rows so the roster always fits one GET page.
	const [counts] = await tx
		.select({
			total: count(),
			active: sql<number>`count(*) filter (where ${wgMembers.deactivatedAt} is null)`.mapWith(
				Number,
			),
		})
		.from(wgMembers)
		.where(eq(wgMembers.wgId, input.wgId));
	if ((counts?.active ?? 0) >= MAX_MEMBERS_PER_WG || (counts?.total ?? 0) >= MAX_MEMBER_ROWS_PER_WG)
		return reject('limit');

	// Case-insensitive: "anna" next to "Anna" could not be told apart in chat and balances. A
	// moved-out member with the name is renamed aside; the unique index only catches the race.
	if (!(await releaseMemberName(tx, input.wgId, input.name))) return reject('name_taken');
	let inserted: typeof wgMembers.$inferSelect | undefined;
	try {
		// A savepoint keeps the transaction usable when the unique index catches a race.
		[inserted] = await tx.transaction((savepoint) =>
			savepoint
				.insert(wgMembers)
				.values({
					wgId: input.wgId,
					name: input.name,
					color: input.color,
					role: 'member',
					authUserId: input.authUserId,
				})
				.onConflictDoNothing({ target: [wgMembers.wgId, wgMembers.name] })
				.returning(),
		);
	} catch (insertErr) {
		if (isUniqueMemberNameViolation(insertErr)) return reject('name_taken');
		throw insertErr;
	}
	if (!inserted) return reject('name_taken');
	await tx
		.update(wgInvites)
		.set({ useCount: sql`${wgInvites.useCount} + 1` })
		.where(eq(wgInvites.id, invite.id));
	return {
		status: 200,
		body: { member: inserted },
		context: { member: inserted, inviteId: invite.id },
	};
}

async function accountDeletionReplayResponse(authUserId: string): Promise<NextResponse | null> {
	try {
		await withTransaction((tx) => assertAccountCanAcquireMembership(tx, authUserId));
		return null;
	} catch (err) {
		if (err instanceof TransactionAbort && err.code === 'account_deletion_pending') {
			return conflict('account_deletion_pending', 'account_deletion_pending');
		}
		throw err;
	}
}

export const POST = withWgRoute('members POST', async (req, { code }) => {
	const parsed = await parseBody(req, joinMemberSchema, { fieldErrors: { name: 'name_invalid' } });
	if (!parsed.ok) return parsed.response;
	const { name, inviteToken = '' } = parsed.data;
	const color = parsed.data.color ?? null;
	const limit = await checkRateLimit(wgWriteLimiter, `join:${clientIpKey(req)}`);
	const limited = rateLimitResponse(limit, 'join_rate_limited', 'join_rate_limited');
	if (limited) return limited;
	const account = await requireAccount(req, 'members POST');
	if (!account.ok) return account.response;
	const { user } = account;
	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { id: true },
	});
	if (!wg) return shareCodeMissResponse(user.id, notFound('wg_not_found'));

	try {
		const result = await withIdempotentWrite(
			{
				scope: `wg-join:${wg.id}:${user.id}`,
				key: readIdempotencyKey(req),
				codec: joinCodec,
				beforeReplay: () => accountDeletionReplayResponse(user.id),
			},
			(tx) =>
				insertJoiningMember(tx, {
					wgId: wg.id,
					code,
					authUserId: user.id,
					name,
					color,
					inviteToken,
				}),
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'replayed' || !result.context) {
			return NextResponse.json(result.body, { status: result.status });
		}
		if ('reason' in result.context) return joinRejectionResponse(result.context.reason);
		const { member, inviteId } = result.context;
		await recordAuditEvent({
			wgId: wg.id,
			memberId: member.id,
			eventType: 'member.joined',
			entityType: 'member',
			entityId: member.id,
			summary: `${member.name} ist der WG per Einladung beigetreten.`,
			metadata: { name: member.name, inviteId },
		});
		return NextResponse.json({ member });
	} catch (err) {
		if (err instanceof TransactionAbort && err.code === 'account_deletion_pending') {
			return conflict('account_deletion_pending', 'account_deletion_pending');
		}
		throw err;
	}
});

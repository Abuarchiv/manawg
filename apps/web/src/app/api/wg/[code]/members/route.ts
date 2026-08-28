import { recordAuditEvent } from '@/core/audit';
import { announcements, db, wgMembers } from '@/core/db';
import { LIMITS } from '@/core/db/schema';
import { withTransaction } from '@/core/db/transaction';
import { HTTP, apiError, badRequest, forbidden, notFound, tooMany } from '@/core/errors';
import { isVerifiedWgAdmin } from '@/core/guards/admin';
import { deriveMemberToken } from '@/core/guards/member-token';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, clientIpKey, wgWriteLimiter } from '@/core/rate-limit';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const MAX_MEMBERS_PER_WG = 20;

async function resolveJoinableWg(
	code: string,
): Promise<{ id: string; joiningEnabled: boolean } | null> {
	const wg = await db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { id: true, joiningEnabled: true },
	});
	return wg ?? null;
}

export const GET = withWgRoute(
	'members GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		// Display-only listing for every member of the WG, including deactivated
		// ("moved-out") ones — they still need to resolve names/balances in
		// history, and choice UIs (identity picker, split/payer dropdowns, chore
		// rotation) filter on the `active` flag instead of the server dropping
		// rows here. Deliberately never includes a token field — a member's
		// session token must only ever be returned to that member themselves
		// (see POST below and GET /api/wg/[code] currentMember), never to other
		// joined members who could otherwise use it to impersonate them on
		// admin-gated routes.
		const rows = await db
			.select({
				id: wgMembers.id,
				name: wgMembers.name,
				color: wgMembers.color,
				deactivatedAt: wgMembers.deactivatedAt,
			})
			.from(wgMembers)
			.where(eq(wgMembers.wgId, wgId));

		const members = rows.map(({ deactivatedAt, ...member }) => ({
			...member,
			active: deactivatedAt === null,
		}));
		// Client-side UI gating only (deactivate/reactivate buttons, chat
		// admin-delete) — every actual mutation re-checks isVerifiedWgAdmin
		// server-side, so a stale/spoofed value here can't grant real access.
		const viewerIsAdmin = await isVerifiedWgAdmin(wgId, auth.member.memberId, auth.member.verified);

		return NextResponse.json({ members, viewerIsAdmin });
	},
	{
		fixture: (fixture) => {
			return NextResponse.json({ members: fixture.members });
		},
	},
);

interface PostBody {
	name?: unknown;
	color?: unknown;
}

function isUniqueMemberNameViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object' || !('code' in err)) return false;
	if ((err as { code?: unknown }).code !== '23505') return false;
	const constraint = (err as { constraint?: unknown }).constraint;
	return constraint === undefined || constraint === 'wg_members_unique_name_per_wg';
}

export const POST = withWgRoute('members POST', async (req, { code }) => {
	let body: PostBody;
	try {
		body = (await req.json()) as PostBody;
	} catch {
		return badRequest('invalid_json');
	}
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const color = typeof body.color === 'string' ? body.color.trim().slice(0, 16) : null;
	if (name.length < 1 || name.length > LIMITS.NAME_MAX) {
		return badRequest('name_invalid');
	}
	const limit = await checkRateLimit(wgWriteLimiter, `join:${clientIpKey(req)}`);
	if (!limit.success) {
		return tooMany('join_rate_limited', 'join_rate_limited');
	}
	const wg = await resolveJoinableWg(code);
	if (!wg) return notFound('wg_not_found');
	if (!wg.joiningEnabled) return forbidden('joining_disabled', 'joining_disabled');

	// The share code is the invite key. Cap the per-WG member count and keep
	// names unique so a leaked code cannot flood the WG indefinitely. Count
	// check and insert run in one transaction behind a row lock on the WG —
	// two concurrent joins would otherwise both pass the cap check (TOCTOU).
	const joinResult = await withTransaction(
		async (
			tx,
		): Promise<
			| { ok: true; member: typeof wgMembers.$inferSelect }
			| { ok: false; reason: 'limit' | 'name_taken' }
		> => {
			await tx.execute(sql`select id from wgs where id = ${wg.id} for update`);
			const memberCount = await tx
				.select({ id: wgMembers.id })
				.from(wgMembers)
				.where(eq(wgMembers.wgId, wg.id));
			if (memberCount.length >= MAX_MEMBERS_PER_WG) {
				return { ok: false, reason: 'limit' };
			}

			const existing = await tx
				.select({ id: wgMembers.id, name: wgMembers.name, color: wgMembers.color })
				.from(wgMembers)
				.where(and(eq(wgMembers.wgId, wg.id), eq(wgMembers.name, name)))
				.limit(1);
			if (existing.length > 0) {
				return { ok: false, reason: 'name_taken' };
			}
			let inserted: typeof wgMembers.$inferSelect | undefined;
			try {
				[inserted] = await tx
					.insert(wgMembers)
					.values({ wgId: wg.id, name, color })
					.onConflictDoNothing({ target: [wgMembers.wgId, wgMembers.name] })
					.returning();
			} catch (insertErr) {
				if (isUniqueMemberNameViolation(insertErr)) {
					return { ok: false, reason: 'name_taken' };
				}
				throw insertErr;
			}
			if (!inserted) return { ok: false, reason: 'name_taken' };
			return { ok: true, member: inserted };
		},
	);
	if (!joinResult.ok) {
		if (joinResult.reason === 'limit') {
			return apiError('member_limit_reached', HTTP.CONFLICT, 'member_limit_reached');
		}
		return apiError('name_taken', HTTP.CONFLICT, 'name_taken');
	}
	const member = joinResult.member;
	const memberWithToken = { ...member, token: deriveMemberToken(wg.id, member.id) };
	await recordAuditEvent({
		wgId: wg.id,
		memberId: member.id,
		eventType: 'member.joined',
		entityType: 'member',
		entityId: member.id,
		summary: `${member.name} ist der WG beigetreten.`,
		metadata: { name: member.name },
	});
	try {
		await db.insert(announcements).values({
			wgId: wg.id,
			authorMemberId: member.id,
			kind: 'info',
			source: 'system',
			sourcePath: '/',
			content: `${member.name} ist der WG beigetreten.`,
		});
	} catch (announcementErr) {
		console.warn('[members POST] system announcement failed', announcementErr);
	}
	return NextResponse.json({ member: memberWithToken });
});

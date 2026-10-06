import { db } from '@/core/db';
import { isWgAdmin } from '@/core/guards/admin';
import { type WgMembershipResult, requireWgMembership } from '@/core/guards/require-wg-member';
import { forbidden, tooMany } from '@/core/http/api-errors';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import type { NextRequest } from 'next/server';

interface AdminWg {
	id: string;
	name: string;
	joiningEnabled: boolean;
}

function loadAdminWg(code: string): Promise<AdminWg | undefined> {
	return db.query.wgs.findFirst({
		where: (w, { eq }) => eq(w.shareCode, code),
		columns: { id: true, name: true, joiningEnabled: true },
	});
}

/**
 * The guard for WG-settings writes: resolve the share code, verify the caller
 * is a member, require the admin role, and take a per-member write slot.
 *
 * These checks are what stand between any member and renaming or deleting
 * the whole WG, so every settings handler goes through this one copy.
 */
export async function requireWgAdmin(
	req: NextRequest,
	code: string,
	/** Rate-limit bucket, e.g. `wg-settings`. Scoped by WG and member. */
	scope: string,
): Promise<WgMembershipResult<AdminWg>> {
	const auth = await requireWgMembership(req, code, 'requireWgAdmin', loadAdminWg);
	if (!auth.ok) return auth;

	if (!(await isWgAdmin(auth.wg.id, auth.member.memberId))) {
		return { ok: false, response: forbidden('not_admin', 'not_admin') };
	}

	const rate = await checkRateLimit(
		wgWriteLimiter,
		`${scope}:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!rate.success) return { ok: false, response: tooMany() };

	return auth;
}

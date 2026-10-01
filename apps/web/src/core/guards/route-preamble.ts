import { HTTP, apiError, badRequest, notFound } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { type E2EWgFixture, getE2EWgFixture, isE2EDbDownMode } from '@/core/infra/e2e-db-down';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';
// Deliberately NOT from '@/core/guards/api-auth', which re-exports the same constant:
// api-auth pulls in the database module, and the E2E db-down path exists
// precisely to answer requests when no database can be loaded. A route test
// asserts that api-auth stays unloaded in that mode.
import { MEMBER_ID_HEADER } from '@/shared/lib/member-header';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * The two steps every `/api/wg/[code]/...` handler runs before it touches its
 * own domain logic.
 *
 * Both used to be copy-pasted into every route, character for character.
 * Copies drift:
 * an identical-looking duplicate of the client-IP logic is exactly how a
 * rate-limit bypass got into this codebase. Having one implementation means a
 * fix lands everywhere at once.
 */

type ShareCodeResult<P> = ({ ok: true; code: string } & P) | { ok: false; response: NextResponse };

/**
 * Read `code` from the route params, normalize it, and reject malformed input.
 *
 * The remaining params are passed through, so nested routes get their `id`
 * from the same call: `const { code, id } = result`.
 *
 * Deliberately kept separate from {@link requireWgMember} so routes can run
 * this cheap syntactic check before parsing a request body — that ordering is
 * what makes `invalid_share_code` win over body validation errors, and several
 * tests assert exactly that precedence.
 */
export async function readShareCode<P extends Record<string, string> = Record<never, never>>(
	ctx: RouteCtx<P & { code: string }>,
): Promise<ShareCodeResult<P>> {
	const { code: rawCode, ...rest } = await ctx.params;
	const code = normalizeShareCode(rawCode);
	if (!isValidShareCode(code)) return { ok: false, response: badRequest('invalid_share_code') };
	return { ok: true, code, ...rest };
}

type E2EFixtureResult =
	| { mode: 'live' }
	| { mode: 'fixture'; fixture: E2EWgFixture; memberId: string }
	| { mode: 'denied'; response: NextResponse };

/**
 * Decide whether this request is served from an E2E fixture instead of the
 * database, and authorize it against that fixture's member list.
 *
 * `live` means the route proceeds normally — outside the E2E db-down setup
 * this is always the answer, so the helper is a no-op in production.
 *
 * The fixture path still enforces membership. That matters: without the check
 * the db-down mode would be an unauthenticated read of WG data, and CI runs
 * with it enabled.
 */
export async function resolveE2EFixture(req: NextRequest, code: string): Promise<E2EFixtureResult> {
	if (!isE2EDbDownMode()) return { mode: 'live' };

	const fixture = getE2EWgFixture(code);
	if (!fixture) return { mode: 'denied', response: notFound('wg_not_found') };

	const memberId = req.headers.get(MEMBER_ID_HEADER);
	if (!memberId) {
		return {
			mode: 'denied',
			response: apiError('auth_required', HTTP.UNAUTHORIZED, 'auth_required'),
		};
	}
	if (!fixture.members.some((member) => member.id === memberId)) {
		return {
			mode: 'denied',
			response: apiError('not_a_member', HTTP.UNAUTHORIZED, 'not_a_member'),
		};
	}

	return { mode: 'fixture', fixture, memberId };
}

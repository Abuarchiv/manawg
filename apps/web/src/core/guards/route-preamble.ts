import type { NextResponse } from 'next/server';
import { badRequest } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { isValidShareCode, normalizeShareCode } from '@/core/utils/share-code';

/**
 * The share-code step every `/api/wg/[code]/...` handler runs before it
 * touches its own domain logic. One implementation instead of per-route
 * copies: copies drift, and an identical-looking duplicate of the client-IP
 * logic is exactly how a rate-limit bypass got into this codebase.
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

import type { NextRequest, NextResponse } from 'next/server';
import { readShareCode } from '@/core/guards/route-preamble';
import { serverError } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';

/**
 * The ceremony every `/api/wg/[code]/...` handler opens and closes with.
 *
 * Reads and validates the share code and wraps the body in a try/catch that
 * logs and returns `server_error`. Per-route copies of these lines drift, and
 * a route that forgets the catch turns a database blip into an unhandled
 * rejection.
 *
 * Deliberately does NOT call `requireWgMember`. Routes that parse a body run
 * their validation before auth so `invalid_body` cannot leak WG membership,
 * and several tests assert exactly that precedence. Handlers therefore keep
 * calling the guard themselves, at the point that suits them.
 */

type WgHandler<P> = (req: NextRequest, params: { code: string } & P) => Promise<NextResponse>;

export function withWgRoute<P extends Record<string, string> = Record<never, never>>(
	/** Prefix for the error log, e.g. `chores GET`. */
	label: string,
	handler: WgHandler<P>,
): (req: NextRequest, ctx: RouteCtx<P & { code: string }>) => Promise<NextResponse> {
	return async (req, ctx) => {
		const codeResult = await readShareCode<P>(ctx);
		if (!codeResult.ok) return codeResult.response;
		const { ok: _ok, ...params } = codeResult;

		try {
			return await handler(req, params as { code: string } & P);
		} catch (err) {
			logApiError(`[${label}]`, err);
			return serverError(err);
		}
	};
}

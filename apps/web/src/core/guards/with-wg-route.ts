import { readShareCode, resolveE2EFixture } from '@/core/guards/route-preamble';
import { serverError } from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import type { E2EWgFixture } from '@/core/infra/e2e-db-down';
import { logApiError } from '@/core/infra/observability';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * The ceremony every `/api/wg/[code]/...` handler opens and closes with.
 *
 * 72 of the 75 handlers repeated the same six lines: read and validate the
 * share code, optionally answer from the E2E fixture, and wrap the body in a
 * try/catch that logs and returns `server_error`. Six lines is small enough
 * that nobody minded copying them, and copies drift — a route that forgets the
 * catch turns a database blip into an unhandled rejection.
 *
 * Deliberately does NOT call `requireWgMember`. Routes that parse a body run
 * their validation before auth so `invalid_body` cannot leak WG membership,
 * and several tests assert exactly that precedence. Handlers therefore keep
 * calling the guard themselves, at the point that suits them.
 */

interface WgRouteOptions {
	/**
	 * How to answer when the E2E db-down fixture is serving this share code.
	 * Omit it — as 30 of the routes do — and the gate is skipped entirely, so
	 * the handler runs as it would in production.
	 */
	fixture?: (fixture: E2EWgFixture, memberId: string) => NextResponse;
}

type WgHandler<P> = (req: NextRequest, params: { code: string } & P) => Promise<NextResponse>;

export function withWgRoute<P extends Record<string, string> = Record<never, never>>(
	/** Prefix for the error log, e.g. `chores GET`. */
	label: string,
	handler: WgHandler<P>,
	options: WgRouteOptions = {},
): (req: NextRequest, ctx: RouteCtx<P & { code: string }>) => Promise<NextResponse> {
	return async (req, ctx) => {
		const codeResult = await readShareCode<P>(ctx);
		if (!codeResult.ok) return codeResult.response;
		const { ok: _ok, ...params } = codeResult;

		if (options.fixture) {
			const e2e = await resolveE2EFixture(req, codeResult.code);
			if (e2e.mode === 'denied') return e2e.response;
			if (e2e.mode === 'fixture') return options.fixture(e2e.fixture, e2e.memberId);
		}

		try {
			return await handler(req, params as { code: string } & P);
		} catch (err) {
			logApiError(`[${label}]`, err);
			return serverError(err);
		}
	};
}

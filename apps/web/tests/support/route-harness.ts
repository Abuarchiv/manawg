import { mock } from 'node:test';
import { NextRequest } from 'next/server';

/**
 * Shared stand-ins for route-handler tests that import the real handler and the real HTTP
 * helpers (`api-errors`, `parse-body`, `with-wg-route`) and mock only what reaches outside the
 * process: auth, rate limits, logging.
 */

export const SHARE_CODE = 'MTE8PZAT';

/**
 * An independent copy of a `src/` module that no `mock.module` call applies to, for a test that
 * mocks a module but still needs some of its real functions. The copy's own imports are
 * unmocked copies too (see the `instance` query in register hooks).
 */
export function importUnmocked(srcPath: string): Promise<unknown> {
	return import(new URL(`../../src/${srcPath}?instance=unmocked`, import.meta.url).href);
}

/** The second argument Next passes a route handler. */
export function routeCtx(params: Record<string, string> = {}): never {
	return { params: Promise.resolve({ code: SHARE_CODE, ...params }) } as never;
}

/** The `NextRequest` a handler receives; a string body is sent as is, anything else as JSON. */
export function request(
	path: string,
	init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
	const { method = 'GET', body, headers = {} } = init;
	return new NextRequest(`https://app.test${path}`, {
		method,
		headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
		...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
	});
}

export interface ObservedErrors {
	logged: { label: string; errors: unknown[] }[];
	captured: unknown[];
}

/** Mock `@/core/infra/observability` and record what the code under test reports. */
export function mockObservability(): ObservedErrors {
	const observed: ObservedErrors = { logged: [], captured: [] };
	mock.module('@/core/infra/observability', {
		namedExports: {
			logApiError: (label: string, ...errors: unknown[]) => {
				observed.logged.push({ label, errors });
			},
			captureException: (err: unknown) => {
				observed.captured.push(err);
			},
			withCronLogging: <T>(_name: string, handler: T) => handler,
		},
	});
	return observed;
}

/** Every limiter `@/core/rate-limit` exports; each stand-in is identified by its name. */
const LIMITER_NAMES = [
	'registerLimiter',
	'wgReadLimiter',
	'wgWriteLimiter',
	'wgShareCodeLookupLimiter',
	'wgShareCodeMissLimiter',
	'notifTestLimiter',
	'reminderSendLimiter',
	'chatReadLimiter',
	'chatMessageLimiter',
	'uploadSignLimiter',
	'wgExportLimiter',
	'dashboardLimiter',
	'expensesReadLimiter',
	'healthLimiter',
	'importLimiter',
	'importCommitLimiter',
] as const;

export interface RateLimitState {
	/** Limiter names that answer "limited". */
	limited: Set<string>;
	/** Every check as `[limiter name, key]`. */
	calls: [string, string][];
}

/** Mock `@/core/rate-limit`: every limiter passes unless its name is in `limited`. */
export function mockRateLimit(): RateLimitState {
	const state: RateLimitState = { limited: new Set(), calls: [] };
	const limiters = Object.fromEntries(LIMITER_NAMES.map((name) => [name, { name }]));
	mock.module('@/core/rate-limit', {
		namedExports: {
			...limiters,
			rateLimitFailMode: () => 'open',
			clientIpKey: () => '203.0.113.1',
			resetOpenStateReporting: () => undefined,
			checkRateLimit: async (limiter: { name: string }, key: string) => {
				state.calls.push([limiter.name, key]);
				const success = !state.limited.has(limiter.name);
				return { success, remaining: success ? 1 : 0, reset: 0 };
			},
		},
	});
	return state;
}

export interface MemberState {
	wg: { id: string; [field: string]: unknown };
	member: { memberId: string; name: string };
	authUserId: string;
	/** When set, the guard answers with this response instead. */
	denied: Response | null;
	calls: { code: string }[];
}

/** Mock `@/core/guards/require-wg-member` with a configurable member. */
export function mockWgMember(initial: Pick<MemberState, 'wg' | 'member'>): MemberState {
	const state: MemberState = {
		...initial,
		authUserId: 'auth-user-1',
		denied: null,
		calls: [],
	};
	const guard = async (_req: unknown, code: string) => {
		state.calls.push({ code });
		if (state.denied) return { ok: false, response: state.denied };
		return { ok: true, wg: state.wg, member: state.member, authUserId: state.authUserId };
	};
	mock.module('@/core/guards/require-wg-member', {
		namedExports: { requireWgMember: guard, requireWgMembership: guard },
	});
	return state;
}

/**
 * A point inside a fake dependency (e.g. the start of a transaction) where the next request can
 * be held, so a test interleaves two requests deterministically.
 */
export class Stall {
	private armed: { reached: () => void; released: Promise<void> } | null = null;

	/** Hold the next request that passes; `reached` resolves once it waits. */
	arm(): { reached: Promise<void>; release: () => void } {
		let reached: () => void = () => undefined;
		let release: () => void = () => undefined;
		const atPoint = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.armed = { reached, released };
		return { reached: atPoint, release };
	}

	/** Called by the fake dependency; waits only when armed. */
	async pass(): Promise<void> {
		const armed = this.armed;
		if (!armed) return;
		this.armed = null;
		armed.reached();
		await armed.released;
	}

	reset(): void {
		this.armed = null;
	}
}

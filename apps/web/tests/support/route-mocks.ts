import { mockModuleWithReal } from './module-mocks';
import { responseError } from './values';

/** Error helpers that answer `{ error: code }`, so tests compare bodies without optional codes. */
export const apiErrorStubs = {
	apiError: (code: string, status: number) => responseError(code, status),
	badRequest: (code: string) => responseError(code, 400),
	conflict: (code: string) => responseError(code, 409),
	forbidden: (code: string) => responseError(code, 403),
	notFound: (code: string) => responseError(code, 404),
	serverError: (code: unknown) =>
		responseError(typeof code === 'string' ? code : 'server_error', 500),
	tooMany: () => responseError('too_many', 429),
};

/**
 * Stand-ins for the modules around every WG write route: an open rate limit, a pass-through
 * `withWgRoute`, a fixed caller from `requireWgMember`, a silent audit log and the error stubs.
 */
export async function mockWgRouteInfrastructure(options: {
	requireWgMember: () => Promise<unknown>;
	logApiError?: (label: string, err: unknown) => void;
	withWgRoute?: (label: string, handler: never) => unknown;
	recordAuditEvent?: () => Promise<void>;
}): Promise<void> {
	await mockModuleWithReal('@/core/audit', {
		recordAuditEvent: options.recordAuditEvent ?? (async () => undefined),
	});
	await mockModuleWithReal('@/core/guards/with-wg-route', {
		withWgRoute: options.withWgRoute ?? ((_name: string, handler: unknown) => handler),
	});
	await mockModuleWithReal('@/core/guards/require-wg-member', {
		requireWgMember: options.requireWgMember,
	});
	await mockModuleWithReal('@/core/guards/api-auth', { UUID_PATTERN: /^[0-9a-f-]{36}$/i });
	await mockModuleWithReal('@/core/infra/observability', {
		logApiError: options.logApiError ?? (() => undefined),
	});
	await mockModuleWithReal('@/core/rate-limit', {
		checkRateLimit: async () => ({ success: true }),
		wgWriteLimiter: {},
		importCommitLimiter: {},
	});
	await mockModuleWithReal('@/core/http/api-errors', apiErrorStubs);
}

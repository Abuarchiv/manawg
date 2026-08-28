/**
 * Shared API route handler types.
 *
 * Next.js 15+ route handlers receive a `ctx` argument whose `params` is a Promise.
 * Use the generic `RouteCtx<P>` instead of redeclaring `interface RouteCtx` in every route file.
 *
 * Examples:
 *   GET(req: NextRequest, ctx: RouteCtx<{ code: string }>): ...
 *   GET(req: NextRequest, ctx: RouteCtx<{ code: string; id: string }>): ...
 */
export type RouteCtx<P extends Record<string, string> = Record<string, string>> = {
	params: Promise<P>;
};

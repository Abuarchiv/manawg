import { type AuthError, AuthSessionMissingError } from '@supabase/supabase-js';
import { z } from 'zod';
import { authGet, authPost } from '@/core/auth/route-helpers';

/**
 * The consent step of the OAuth flow that connects an AI agent through the ManaWG MCP server.
 * Supabase Auth runs the authorization server and sends the browser to /oauth/consent with an
 * `authorization_id`; these handlers read that request and record the person's decision.
 *
 * Answers are `{ status: 'consent' | 'redirect' | 'invalid' }`; signed out is 401 auth_required.
 */

const AUTHORIZATION_ID = /^[\w-]{1,128}$/;
const INVALID = { status: 'invalid' } as const;

/** The client's redirect target, or null for a scheme that would run code in this page. */
function safeRedirect(value: string): string | null {
	try {
		const url = new URL(value);
		return ['javascript:', 'data:', 'vbscript:', 'blob:'].includes(url.protocol) ? null : url.href;
	} catch {
		return null;
	}
}

function redirectTo(value: string) {
	const redirectUrl = safeRedirect(value);
	return redirectUrl ? ({ status: 'redirect', redirectUrl } as const) : INVALID;
}

function hostOf(uri: string | undefined): string | null {
	if (!uri) return null;
	try {
		return new URL(uri).host || null;
	} catch {
		return null;
	}
}

/**
 * An expired, used or unknown request is the person's outcome, not an outage. A missing session
 * also answers 400; it is rethrown so the page offers the sign-in instead.
 */
function isGone(error: AuthError): boolean {
	if (error instanceof AuthSessionMissingError) return false;
	return error.status === 400 || error.status === 404;
}

export const GET = authGet(async ({ supabase, request }) => {
	const id = request.nextUrl.searchParams.get('authorization_id') ?? '';
	if (!AUTHORIZATION_ID.test(id)) return INVALID;
	const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
	if (error) {
		if (isGone(error)) return INVALID;
		throw error;
	}
	// Consent was given before for these scopes: straight back to the agent.
	if ('redirect_url' in data) return redirectTo(data.redirect_url);
	return {
		status: 'consent',
		authorizationId: data.authorization_id,
		clientName: data.client.name || null,
		// The registered redirect decides where the code goes; the client's own uri is self-declared.
		clientHost: hostOf(data.redirect_uri),
		email: data.user.email,
	} as const;
});

export const POST = authPost(
	z.object({ authorizationId: z.string().regex(AUTHORIZATION_ID), approve: z.boolean() }),
	async ({ supabase, data }) => {
		const { oauth } = supabase.auth;
		const options = { skipBrowserRedirect: true };
		const { data: result, error } = data.approve
			? await oauth.approveAuthorization(data.authorizationId, options)
			: await oauth.denyAuthorization(data.authorizationId, options);
		if (error) {
			if (isGone(error)) return INVALID;
			throw error;
		}
		return redirectTo(result.redirect_url);
	},
);

import { z } from 'zod';
import { authPost } from '@/core/auth/route-helpers';

/** Disconnects an agent: Supabase revokes the consent and ends its sessions and refresh tokens. */
export const POST = authPost(z.object({ clientId: z.uuid() }), async ({ supabase, data }) => {
	const { error } = await supabase.auth.oauth.revokeGrant({ clientId: data.clientId });
	// Already disconnected (another tab, the agent itself): the outcome the person wanted.
	if (error && error.status !== 404) throw error;
	return { ok: true };
});

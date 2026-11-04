import { authGet } from '@/core/auth/route-helpers';

/** The AI agents this account has connected through the ManaWG MCP server (OAuth grants). */
export const GET = authGet(async ({ supabase }) => {
	const { data, error } = await supabase.auth.oauth.listGrants();
	if (error) throw error;
	return {
		agents: data.map((grant) => ({
			clientId: grant.client.id,
			name: grant.client.name || null,
			grantedAt: grant.granted_at,
		})),
	};
});

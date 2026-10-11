import { authPost } from '@/core/auth/route-helpers';
import { nextField, providerField } from '@/core/auth/route-schemas';
import { z } from 'zod';

const schema = z.object({ provider: providerField, next: nextField });

/** Starts the provider sign-in; the PKCE verifier cookie is set here, the browser follows `url`. */
export const POST = authPost(
	schema,
	async ({ supabase, data, callbackUrl }) => {
		const { data: result, error } = await supabase.auth.signInWithOAuth({
			provider: data.provider,
			options: { redirectTo: callbackUrl(data.next), skipBrowserRedirect: true },
		});
		if (error) throw error;
		return { url: result.url };
	},
	{ limited: true },
);

import { z } from 'zod';
import { authPost } from '@/core/auth/route-helpers';
import { emailField, passwordField } from '@/core/auth/route-schemas';

const schema = z.object({ email: emailField, password: passwordField });

/** E-mail + password sign-in; the session cookies are set by the server. */
export const POST = authPost(
	schema,
	async ({ supabase, data }) => {
		const { data: result, error } = await supabase.auth.signInWithPassword(data);
		if (error) throw error;
		return { sessionEstablished: result.session !== null };
	},
	{ limited: true },
);

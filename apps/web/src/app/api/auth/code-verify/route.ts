import { authPost } from '@/core/auth/route-helpers';
import { emailField } from '@/core/auth/route-schemas';
import { z } from 'zod';

const schema = z.object({ email: emailField, token: z.string().regex(/^\d{4,12}$/) });

/** Exchanges the mailed code for a session; the cookies are set by the server. */
export const POST = authPost(
	schema,
	async ({ supabase, data }) => {
		const { data: result, error } = await supabase.auth.verifyOtp({ ...data, type: 'email' });
		if (error) throw error;
		return { sessionEstablished: result.session !== null };
	},
	{ limited: true },
);

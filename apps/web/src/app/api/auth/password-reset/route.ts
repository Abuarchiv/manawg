import { z } from 'zod';
import { authPost } from '@/core/auth/route-helpers';
import { emailField } from '@/core/auth/route-schemas';

const schema = z.object({ email: emailField });

/** Mails a recovery link; Supabase answers the same for unknown addresses. */
export const POST = authPost(
	schema,
	async ({ supabase, data, callbackUrl }) => {
		const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
			redirectTo: callbackUrl('/auth/reset'),
		});
		if (error) throw error;
		return { ok: true };
	},
	{ limited: true },
);

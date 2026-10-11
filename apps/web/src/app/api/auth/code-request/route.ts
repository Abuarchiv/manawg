import { authPost } from '@/core/auth/route-helpers';
import { emailField } from '@/core/auth/route-schemas';
import { z } from 'zod';

const schema = z.object({ email: emailField });

/** Mails a one-time code to an existing account; unknown addresses are rejected, not created. */
export const POST = authPost(
	schema,
	async ({ supabase, data }) => {
		const { error } = await supabase.auth.signInWithOtp({
			email: data.email,
			options: { shouldCreateUser: false },
		});
		if (error) throw error;
		return { ok: true };
	},
	{ limited: true },
);

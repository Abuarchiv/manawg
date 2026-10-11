import { authPost } from '@/core/auth/route-helpers';
import { emailField, nextField } from '@/core/auth/route-schemas';
import { z } from 'zod';

const schema = z.object({ email: emailField, next: nextField });

/** Sends the sign-up confirmation mail again; never reveals whether the address exists. */
export const POST = authPost(
	schema,
	async ({ supabase, data, callbackUrl }) => {
		const { error } = await supabase.auth.resend({
			type: 'signup',
			email: data.email,
			options: { emailRedirectTo: callbackUrl(data.next) },
		});
		if (error) throw error;
		return { ok: true };
	},
	{ limited: true },
);

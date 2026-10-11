import { authPost } from '@/core/auth/route-helpers';
import { emailField } from '@/core/auth/route-schemas';
import { z } from 'zod';

/** Supabase's answer when no account exists for the address (signups are off for codes). */
const NO_ACCOUNT_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found']);

const schema = z.object({ email: emailField });

/** Mails a one-time code to an existing account. An unknown address is not created and not revealed. */
export const POST = authPost(
	schema,
	async ({ supabase, data }) => {
		const { error } = await supabase.auth.signInWithOtp({
			email: data.email,
			options: { shouldCreateUser: false },
		});
		if (error && !NO_ACCOUNT_CODES.has((error as { code?: string }).code ?? '')) throw error;
		return { ok: true };
	},
	{ limited: true },
);

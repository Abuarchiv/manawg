import { authPost } from '@/core/auth/route-helpers';
import { emailField, nextField } from '@/core/auth/route-schemas';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { z } from 'zod';

const schema = z.object({ email: emailField, next: nextField });

/** Starts an e-mail change for the signed-in account; Supabase mails a confirmation link. */
export const POST = authPost(
	schema,
	async ({ supabase, data, callbackUrl }) => {
		const { data: current, error: sessionError } = await supabase.auth.getUser();
		if (sessionError) throw sessionError;
		if (!current.user) throw new AuthSessionMissingError();
		const { error } = await supabase.auth.updateUser(
			{ email: data.email },
			{ emailRedirectTo: callbackUrl(data.next) },
		);
		if (error) throw error;
		return { ok: true };
	},
	{ limited: true },
);

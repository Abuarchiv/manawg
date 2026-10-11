import { authPost } from '@/core/auth/route-helpers';
import { emailField, nameField, nextField, passwordField } from '@/core/auth/route-schemas';
import { z } from 'zod';

const schema = z.object({
	email: emailField,
	password: passwordField,
	name: nameField,
	next: nextField,
});

/** Creates the account; the response is the same for an address that already exists. */
export const POST = authPost(
	schema,
	async ({ supabase, data, callbackUrl }) => {
		const { data: result, error } = await supabase.auth.signUp({
			email: data.email,
			password: data.password,
			options: { emailRedirectTo: callbackUrl(data.next), data: { full_name: data.name } },
		});
		if (error) throw error;
		return { sessionEstablished: result.session !== null };
	},
	{ limited: true },
);

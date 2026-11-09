import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
	justConfirmed,
	passwordPending,
	passwordRecoveryCookie,
} from '@/core/auth/password-pending';
import { authPost } from '@/core/auth/route-helpers';
import { emailField, nameField } from '@/core/auth/route-schemas';
import { queueWelcomeMail } from '@/core/auth/welcome-mail';
import { requestLocale } from '@/core/i18n/request-locale';

const schema = z.object({
	email: emailField,
	token: z.string().regex(/^\d{4,12}$/),
	// The name typed into the registration form; see `applyRegisteredName`.
	name: nameField.optional(),
});

/**
 * Auth keeps the name stored by the first code request for an address that never confirmed, so a
 * stranger who asked for a code first would leave their name on the owner's account. The one who
 * just proved the address takes the name from their own form. Only an address that this code just
 * confirmed is renamed; signing in to an older account never touches the name.
 */
async function applyRegisteredName(auth: SupabaseClient['auth'], name: string): Promise<boolean> {
	const { data } = await auth.getUser();
	const user = data.user;
	if (!user || !justConfirmed(user) || user.user_metadata?.full_name === name) return false;
	const { error } = await auth.updateUser({ data: { full_name: name } });
	return !error;
}

/** Exchanges the mailed code for a session; the cookies are set by the server. */
export const POST = authPost(
	schema,
	async ({ supabase, data, request, cookies }) => {
		const { data: result, error } = await supabase.auth.verifyOtp({
			email: data.email,
			token: data.token,
			type: 'email',
		});
		if (error) throw error;
		let user = result.session?.user;
		let choosePassword = false;
		if (user) {
			if (data.name && (await applyRegisteredName(supabase.auth, data.name).catch(() => false))) {
				user = { ...user, user_metadata: { ...user.user_metadata, full_name: data.name } };
			}
			queueWelcomeMail(user, requestLocale(request));
			// A code that confirms an unconfirmed address drops the password stored before.
			choosePassword = await passwordPending(supabase.auth);
			if (choosePassword) {
				cookies.set(passwordRecoveryCookie(user.id, request.nextUrl.protocol === 'https:'));
			}
		}
		return { sessionEstablished: result.session !== null, passwordPending: choosePassword };
	},
	{ limited: true },
);

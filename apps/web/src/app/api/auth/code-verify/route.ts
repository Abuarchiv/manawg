import { z } from 'zod';
import { passwordPending, passwordRecoveryCookie } from '@/core/auth/password-pending';
import { authPost } from '@/core/auth/route-helpers';
import { emailField } from '@/core/auth/route-schemas';
import { queueWelcomeMail } from '@/core/auth/welcome-mail';
import { requestLocale } from '@/core/i18n/request-locale';

const schema = z.object({ email: emailField, token: z.string().regex(/^\d{4,12}$/) });

/** Exchanges the mailed code for a session; the cookies are set by the server. */
export const POST = authPost(
	schema,
	async ({ supabase, data, request, cookies }) => {
		const { data: result, error } = await supabase.auth.verifyOtp({ ...data, type: 'email' });
		if (error) throw error;
		const user = result.session?.user;
		let choosePassword = false;
		if (user) {
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

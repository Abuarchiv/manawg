import { z } from 'zod';
import { CODE_REGISTRATION_METADATA } from '@/core/auth/password-pending';
import { authPost } from '@/core/auth/route-helpers';
import { emailField, nameField } from '@/core/auth/route-schemas';
import { requestLocale } from '@/core/i18n/request-locale';

/** Supabase's answer when no account exists for the address (signups are off for codes). */
const NO_ACCOUNT_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found']);

/** With a `name` the request is a registration; without one it only signs in an existing account. */
const schema = z.object({ email: emailField, name: nameField.optional() });

/**
 * Mails a one-time code. Registration (with a name) creates the account unconfirmed and no password
 * exists until the owner of the address enters the code; an existing address gets its sign-in code
 * instead and keeps its data. Sign-in alone never creates an account. Both answer `ok` for every
 * address, so the response does not reveal whether an account exists.
 */
export const POST = authPost(
	schema,
	async ({ supabase, data, request }) => {
		const registering = data.name !== undefined;
		const { error } = await supabase.auth.signInWithOtp({
			email: data.email,
			options: registering
				? {
						shouldCreateUser: true,
						data: {
							full_name: data.name,
							locale: requestLocale(request),
							...CODE_REGISTRATION_METADATA,
						},
					}
				: { shouldCreateUser: false },
		});
		// Registration is only refused for the whole instance (signups off), which says nothing about the address.
		if (error && (registering || !NO_ACCOUNT_CODES.has((error as { code?: string }).code ?? '')))
			throw error;
		return { ok: true };
	},
	{ limited: true },
);

import { AuthSessionMissingError } from '@supabase/supabase-js';
import { authGet } from '@/core/auth/route-helpers';
import { MEMBER_NAME_MAX_LENGTH } from '@/shared/lib/limits';

/** What the account settings and the start flow need to know about the signed-in account. */
export const GET = authGet(async ({ supabase }) => {
	const { data, error } = await supabase.auth.getUser();
	if (error) throw error;
	const user = data.user;
	if (!user) throw new AuthSessionMissingError();
	const providers = (user.identities ?? []).map((identity) => identity.provider);
	const meta = user.user_metadata as Record<string, unknown>;
	const name = [meta.full_name, meta.name, meta.given_name].find(
		(value): value is string => typeof value === 'string' && value.trim().length > 0,
	);
	return {
		email: user.email ?? null,
		hasPassword: providers.includes('email'),
		hasGoogle: providers.includes('google'),
		name: name ? name.trim().slice(0, MEMBER_NAME_MAX_LENGTH) : null,
	};
});

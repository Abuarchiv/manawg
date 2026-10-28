import { AuthSessionMissingError } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertPasswordNotPwned } from '@/core/auth/pwned-password';
import { authPost } from '@/core/auth/route-helpers';
import { passwordField } from '@/core/auth/route-schemas';

const schema = z.object({ password: passwordField });

/** Sets a new password for the signed-in account (settings or recovery link). */
export const POST = authPost(schema, async ({ supabase, data }) => {
	const { data: current, error: sessionError } = await supabase.auth.getUser();
	if (sessionError) throw sessionError;
	if (!current.user) throw new AuthSessionMissingError();
	await assertPasswordNotPwned(data.password);
	const { error } = await supabase.auth.updateUser({ password: data.password });
	if (error) throw error;
	return { ok: true };
});

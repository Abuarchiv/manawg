import { SESSION_HINT_COOKIE, sessionHintCookieOptions } from '@/core/auth/cookie-options';
import { authPost } from '@/core/auth/route-helpers';
import { z } from 'zod';

/** Ends this browser's session (every device with `everywhere`) and removes every Supabase cookie. */
export const POST = authPost(
	z.object({ everywhere: z.boolean().optional() }),
	async ({ supabase, cookies, request, data }) => {
		const { error } = await supabase.auth.signOut({ scope: data.everywhere ? 'global' : 'local' });
		if (error) throw error;
		for (const { name } of request.cookies.getAll()) {
			if (name.startsWith('sb-')) cookies.set(name, '', { path: '/', maxAge: 0 });
		}
		cookies.set(SESSION_HINT_COOKIE, '', {
			...sessionHintCookieOptions(request.nextUrl.protocol === 'https:'),
			maxAge: 0,
		});
		return { ok: true };
	},
);

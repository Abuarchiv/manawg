import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/core/auth/server';
import { hasSupabaseEnv } from '@/core/auth/supabase-env';
import { db, wgMembers } from '@/core/db';
import { requireAccount } from '@/core/guards/require-account';
import { serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { logApiError } from '@/core/infra/observability';
import type { Locale } from '@/shared/i18n/locale';

const localeSchema = z.object({ locale: z.enum(['de', 'en']) satisfies z.ZodType<Locale> });

/**
 * Stores the language choice of the signed-in person: every membership row of the account (push
 * and mail read it there) and the account metadata (auth mail templates read it there).
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
	const account = await requireAccount(req, 'api/account PATCH');
	if (!account.ok) return account.response;
	const parsed = await parseBody(req, localeSchema, { fieldErrors: { locale: 'locale_invalid' } });
	if (!parsed.ok) return parsed.response;
	const { locale } = parsed.data;

	try {
		await db.update(wgMembers).set({ locale }).where(eq(wgMembers.authUserId, account.user.id));
	} catch (err) {
		logApiError('[api/account PATCH] member update failed', err);
		return serverError('db_error');
	}

	const response = NextResponse.json({ locale });
	if (!hasSupabaseEnv()) return response;
	// The metadata only feeds mail templates, so a failed write must not undo the saved choice.
	try {
		const cookieHolder = NextResponse.next();
		const { error } = await createSupabaseServerClient(req, cookieHolder).auth.updateUser({
			data: { locale },
		});
		if (error) throw error;
		for (const cookie of cookieHolder.cookies.getAll()) response.cookies.set(cookie);
	} catch (err) {
		logApiError('[api/account PATCH] metadata update failed', err);
	}
	return response;
}

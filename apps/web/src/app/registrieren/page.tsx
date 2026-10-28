import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { authIntentQuery, authPageHref } from '@/core/auth/auth-intent';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';
import { RegistrierenClient } from './RegistrierenClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('meta.register');
	return {
		title: t('title'),
		description: t('description'),
		robots: { index: false, follow: false },
	};
}

type SearchParams = Record<string, string | string[] | undefined>;

function toSearch(params: SearchParams): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		const first = Array.isArray(value) ? value[0] : value;
		if (first !== undefined) search.set(key, first);
	}
	return search.toString();
}

export default async function RegistrierenPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const search = toSearch(await searchParams);
	// A transient Auth failure must not lock a visitor out of the form.
	const user = await getAuthenticatedUserFromCookies().catch(() => null);
	if (user) redirect(authPageHref('/neu', search));
	return <RegistrierenClient intentQuery={authIntentQuery(search)} />;
}

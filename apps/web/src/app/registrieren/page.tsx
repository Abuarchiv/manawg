import { authIntentQuery, authPageHref } from '@/core/auth/auth-intent';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegistrierenClient } from './RegistrierenClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Konto erstellen — ManaWG',
	description: 'Lege dein ManaWG-Konto an, um eine WG zu erstellen oder einer WG beizutreten.',
};

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
}: { searchParams: Promise<SearchParams> }) {
	const search = toSearch(await searchParams);
	// A transient Auth failure must not lock a visitor out of the form.
	const user = await getAuthenticatedUserFromCookies().catch(() => null);
	if (user) redirect(authPageHref('/neu', search));
	return <RegistrierenClient intentQuery={authIntentQuery(search)} />;
}

import type { MetadataRoute } from 'next';
import { cookies, headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { htmlLang, LOCALE_COOKIE, resolveLocale } from '@/shared/i18n/locale';

// The language comes from the request, so the manifest is rendered per request.
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
	const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
	const locale = resolveLocale({
		cookie: cookieStore.get(LOCALE_COOKIE)?.value,
		acceptLanguage: headerStore.get('accept-language'),
	});
	const t = await getTranslations({ locale, namespace: 'meta.manifest' });

	return {
		name: 'ManaWG',
		short_name: 'ManaWG',
		description: t('description'),
		lang: htmlLang(locale),
		dir: 'ltr',
		id: '/',
		start_url: '/?source=pwa',
		scope: '/',
		prefer_related_applications: false,
		display: 'standalone',
		background_color: '#FFFFFF',
		theme_color: '#0A0A0A',
		categories: ['lifestyle', 'productivity', 'social'],
		icons: [
			{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{ src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
			{ src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
			{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
		],
		shortcuts: [
			{
				name: t('shortcutName'),
				short_name: t('shortcutShortName'),
				description: t('shortcutDescription'),
				url: '/login?source=pwa-shortcut',
				icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
			},
		],
	};
}

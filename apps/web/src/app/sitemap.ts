import { getAppUrl } from '@/shared/lib/app-url';
import type { MetadataRoute } from 'next';
import { PUBLIC_MODULES } from './entdecken/[module]/public-modules';

export default function sitemap(): MetadataRoute.Sitemap {
	const base = getAppUrl();
	return [
		`${base}/`,
		`${base}/registrieren`,
		...Object.keys(PUBLIC_MODULES).map((slug) => `${base}/entdecken/${slug}`),
	].map((url) => ({ url }));
}

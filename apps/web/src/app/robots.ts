import { getAppUrl } from '@/shared/lib/app-url';
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
	return {
		rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/auth/', '/wg/', '/offline'] },
		sitemap: `${getAppUrl()}/sitemap.xml`,
	};
}

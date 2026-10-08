import type { MetadataRoute } from 'next';

// Pages stay crawlable so search engines see the noindex set in layout.tsx
export default function robots(): MetadataRoute.Robots {
	return {
		rules: [{ userAgent: '*', allow: ['/'], disallow: ['/api/'] }],
		sitemap: 'https://manawg.com/sitemap.xml',
	};
}

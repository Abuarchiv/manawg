import type { MetadataRoute } from 'next';

// Seiten bleiben crawlbar, damit Suchmaschinen das noindex aus layout.tsx sehen
export default function robots(): MetadataRoute.Robots {
	return {
		rules: [{ userAgent: '*', allow: ['/'], disallow: ['/api/'] }],
		sitemap: 'https://manawg.com/sitemap.xml',
	};
}

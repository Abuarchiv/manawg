import type { MetadataRoute } from 'next';
import { isOfficialInstance, landingUrl } from '@/shared/lib/landing-url';

// Search engines may crawl everything so they can read the noindex from layout.tsx;
// the only sitemap of the brand lives on the landing. AI crawlers get the brand from
// manawg.com (llms.txt there) and have no business in WG, invite or auth pages.
export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: [
					'GPTBot',
					'OAI-SearchBot',
					'ChatGPT-User',
					'ClaudeBot',
					'Claude-SearchBot',
					'Claude-User',
					'PerplexityBot',
					'Perplexity-User',
					'Google-Extended',
					'Applebot-Extended',
					'CCBot',
				],
				allow: ['/'],
				disallow: ['/wg/', '/invite/', '/auth/', '/api/'],
			},
			{ userAgent: '*', allow: ['/'], disallow: ['/api/'] },
		],
		// The sitemap lists the landing's pages, which only belong to the official instance.
		...(isOfficialInstance(process.env.NEXT_PUBLIC_APP_URL)
			? { sitemap: landingUrl('/sitemap.xml') }
			: {}),
	};
}

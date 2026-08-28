import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
	enabled: process.env.ANALYZE === 'true',
	openAnalyzer: false,
});

const securityHeaders = [
	{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
	{ key: 'X-Content-Type-Options', value: 'nosniff' },
	{ key: 'X-Frame-Options', value: 'DENY' },
	{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
	{
		key: 'Permissions-Policy',
		value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
	},
	{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
	{ key: 'X-DNS-Prefetch-Control', value: 'on' },
];

// craftsman-ignore: TS002 — Next.js config requires default export
const nextConfig: NextConfig = {
	distDir: process.env.NEXT_DIST_DIR ?? '.next',
	// @manawg/shared ships raw TS/TSX (no build step) — Next transpiles it
	// itself, same as it does for this app's own src/.
	transpilePackages: ['@manawg/shared'],
	// Multi-zone setup: the `landing` zone owns the domain root and proxies
	// /wg, /api, /neu, /offline, /.well-known to this app via rewrites (see
	// apps/landing/next.config.ts). This app's own pages stay at their normal
	// URLs (no basePath), but its `_next/static` etc. asset URLs need a
	// private prefix landing can forward too, distinct from any real page
	// path — otherwise the browser requests them from landing's own origin
	// (where they don't exist) and every script/style 404s in production.
	assetPrefix: '/wg-assets',
	typescript: {
		ignoreBuildErrors: false,
		tsconfigPath: process.env.NEXT_TSCONFIG_PATH ?? 'tsconfig.json',
	},
	eslint: {
		ignoreDuringBuilds: false,
	},
	images: {
		remotePatterns: [
			{
				protocol: 'https',
				hostname: '*.amazonaws.com',
			},
		],
	},
	async headers() {
		return [{ source: '/:path*', headers: securityHeaders }];
	},
	experimental: {
		optimizePackageImports: ['lucide-react'],
	},
};

export default withBundleAnalyzer(nextConfig);

import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

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
		value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
	},
	{ key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
	env: {
		NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
		NEXT_PUBLIC_SENTRY_RELEASE:
			process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
	},
	distDir: process.env.NEXT_DIST_DIR ?? '.next',
	typescript: {
		ignoreBuildErrors: false,
		tsconfigPath: process.env.NEXT_TSCONFIG_PATH ?? 'tsconfig.json',
	},
	eslint: {
		ignoreDuringBuilds: false,
	},
	// Browsers and bookmark importers still ask for /favicon.ico; the metadata icons are PNG/SVG.
	async rewrites() {
		return [{ source: '/favicon.ico', destination: '/favicon-32.png' }];
	},
	// next/image is not used; without remote patterns /_next/image cannot be
	// used as a free proxy for arbitrary S3 buckets on this project's quota.
	async headers() {
		return [
			{ source: '/:path*', headers: securityHeaders },
			// Vercel otherwise labels header-less API responses "public, max-age=0, must-revalidate".
			// Routes that set their own Cache-Control keep it.
			{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
		];
	},
	experimental: {
		// Besuchte/vorab geladene Tabs bleiben 5 Min. im Router-Cache: ein Tab-Tipp ohne Netz bleibt in
		// der App (letzte Daten) statt per Hard-Navigation auf die Offline-Seite zu fallen.
		staleTimes: { dynamic: 300, static: 300 },
		// motion/react bindet über `const motion = fm.motion` die komplette Feature-Bundle-Variante ein;
		// optimizePackageImports löst die Importe auf die Einzelmodule auf (LazyMotion lädt sonst nichts nach).
		optimizePackageImports: ['lucide-react', 'motion/react'],
	},
};

const withNextIntl = createNextIntlPlugin();
const analyzedConfig = withBundleAnalyzer(withNextIntl(nextConfig));
const sentryUploadOptions =
	process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN
		? {
				org: process.env.SENTRY_ORG,
				project: process.env.SENTRY_PROJECT,
				authToken: process.env.SENTRY_AUTH_TOKEN,
				release: {
					name: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
				},
				widenClientFileUpload: true,
				hideSourceMaps: true,
				telemetry: false,
				silent: !process.env.CI,
			}
		: undefined;

export default sentryUploadOptions
	? withSentryConfig(analyzedConfig, sentryUploadOptions)
	: analyzedConfig;

import path from 'node:path';
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
	// next dev otherwise writes an AGENTS.md into the app when it detects a coding agent.
	agentRules: false,
	// The Docker image (Dockerfile) runs the self-contained server; Vercel builds without it.
	...(process.env.NEXT_OUTPUT_STANDALONE === 'true'
		? { output: 'standalone' as const, outputFileTracingRoot: path.join(process.cwd(), '..', '..') }
		: {}),
	typescript: {
		ignoreBuildErrors: false,
		tsconfigPath: process.env.NEXT_TSCONFIG_PATH ?? 'tsconfig.json',
	},
	// Browsers and bookmark importers still ask for /favicon.ico; the metadata icons are PNG/SVG.
	async rewrites() {
		return [{ source: '/favicon.ico', destination: '/favicon-32.png' }];
	},
	// The pages had German paths until 2026-10; links in old mails, bookmarks and installed PWAs keep working.
	async redirects() {
		const top = {
			neu: 'login',
			registrieren: 'signup',
			einladung: 'invite',
			entdecken: 'discover',
		};
		const wg = {
			abos: 'recurring',
			abrechnung: 'statement',
			aktivitaet: 'activity',
			ausgaben: 'expenses',
			einkauf: 'shopping',
			einstellungen: 'settings',
			kalender: 'calendar',
			mahnungen: 'reminders',
			pinnwand: 'pinboard',
			putzen: 'chores',
			vorraete: 'supplies',
		};
		// Public previews use the same slugs, except Fixkosten, which was `fixkosten` there.
		const modules = { ...wg, fixkosten: 'recurring' };
		return [
			...Object.entries(modules).map(([from, to]) => ({
				source: `/:prefix(entdecken|discover)/${from}`,
				destination: `/discover/${to}`,
				permanent: true,
			})),
			...Object.entries(top).map(([from, to]) => ({
				source: `/${from}/:path*`,
				destination: `/${to}/:path*`,
				permanent: true,
			})),
			...Object.entries(wg).map(([from, to]) => ({
				source: `/wg/:code/${from}/:path*`,
				destination: `/wg/:code/${to}/:path*`,
				permanent: true,
			})),
		];
	},
	// next/image is not used; without remote patterns /_next/image cannot be
	// used as a free proxy for arbitrary remote images on this project's quota.
	async headers() {
		return [
			{ source: '/:path*', headers: securityHeaders },
			// Vercel otherwise labels header-less API responses "public, max-age=0, must-revalidate".
			// Routes that set their own Cache-Control keep it.
			{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
		];
	},
	experimental: {
		// TypeScript 7 ships no compiler API, so the build type-checks with its CLI.
		useTypeScriptCli: true,
		// Visited and prefetched tabs stay in the router cache for 5 minutes: a tab tap without a
		// network stays in the app (last data) instead of falling back to the offline page.
		staleTimes: { dynamic: 300, static: 300 },
		// motion/react pulls in the complete feature bundle via `const motion = fm.motion`;
		// optimizePackageImports resolves the imports to the single modules (LazyMotion loads nothing
		// extra otherwise).
		optimizePackageImports: ['lucide-react', 'motion/react'],
	},
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
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

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import Script from 'next/script';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { InputModality } from '@/components/app/InputModality';
import { InstallPrompt } from '@/components/app/InstallPrompt';
import { DeviceLocaleSync } from '@/components/app/LanguageSwitch';
import { PwaRegister } from '@/components/app/PwaRegister';
import { ThemeProvider } from '@/components/app/ThemeProvider';
import { GoogleSignInProvider } from '@/components/auth/google-sign-in';
import { SplashScreen } from '@/components/brand/SplashScreen';
import { htmlLang } from '@/shared/i18n/locale';
import { pickMessages, ROOT_CLIENT_NAMESPACES } from '@/shared/i18n/root-client-messages';
import { getAppUrl } from '@/shared/lib/app-url';
import { APP_SCHEMA_ID, IS_OFFICIAL_INSTANCE, LANDING_SCHEMA_IDS } from '@/shared/lib/landing-url';
import { SPLASH_BOOTSTRAP_SCRIPT } from '@/shared/lib/splash';
import { THEME_BOOTSTRAP_SCRIPT } from '@/shared/lib/theme';
import '@/shared/globals.css';

export const dynamic = 'force-dynamic';

const inter = localFont({
	src: '../shared/fonts/inter-latin.woff2',
	weight: '100 900',
	variable: '--font-inter',
	display: 'swap',
});

const interTight = localFont({
	src: '../shared/fonts/inter-tight-latin.woff2',
	weight: '100 900',
	variable: '--font-inter-tight',
	display: 'swap',
});

const jetbrainsMono = localFont({
	src: '../shared/fonts/jetbrains-mono-latin.woff2',
	weight: '100 800',
	variable: '--font-jetbrains-mono',
	display: 'swap',
	// Amounts only: not worth 31 kB on the critical path of every first paint.
	preload: false,
});

const appUrl = getAppUrl();

// Brand title and description are word-for-word those of the marketing site (manawg.com),
// so link previews and crawlers read one product definition across both origins.
const brandTitle = 'ManaWG, die WG-App: Ausgaben, Einkauf, Putzplan für eure WG'; // i18n-ignore German brand head, identical to the landing; page routes localise through meta.brand
const metaDescription =
	// i18n-ignore German brand head, identical to the landing
	'Mit ManaWG teilt ihr Ausgaben, organisiert Einkäufe und verteilt Aufgaben im Putzplan. Die App ist kostenlos und läuft im Browser.';

// Same entity the marketing site declares (same @id, same publisher), so both
// origins describe one app and one organisation instead of two competing ones.
const softwareApplicationSchema = {
	'@context': 'https://schema.org',
	'@type': 'SoftwareApplication',
	'@id': APP_SCHEMA_ID,
	name: 'ManaWG',
	description: metaDescription,
	url: appUrl,
	applicationCategory: 'LifestyleApplication',
	operatingSystem: 'Web',
	inLanguage: 'de-DE',
	isAccessibleForFree: true,
	offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
	publisher: { '@id': LANDING_SCHEMA_IDS.organisation },
};

export const metadata: Metadata = {
	metadataBase: new URL(appUrl),
	title: { default: brandTitle, template: '%s — ManaWG' },
	description: metaDescription,
	keywords: ['WG', 'Wohngemeinschaft', 'Ausgaben teilen', 'Putzplan', 'WG App', 'DSGVO'], // i18n-ignore German brand head, identical to the landing
	authors: [{ name: 'ManaWG' }],
	applicationName: 'ManaWG',
	// Search should surface manawg.com; app pages stay out of the index
	robots: {
		index: false,
		follow: true,
	},
	openGraph: {
		title: brandTitle,
		description: metaDescription,
		type: 'website',
		locale: 'de_DE',
		siteName: 'ManaWG',
		images: [
			{
				url: '/opengraph-image',
				width: 1200,
				height: 630,
				alt: 'ManaWG',
			},
		],
	},
	twitter: {
		card: 'summary_large_image',
		title: brandTitle,
		description: metaDescription,
		images: ['/opengraph-image'],
	},
	manifest: '/manifest.json',
	icons: {
		icon: [
			{ url: '/favicon.svg', type: 'image/svg+xml' },
			{ url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
			{ url: '/favicon-16.png', type: 'image/png', sizes: '16x16' },
			{ url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
			{ url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
		],
		apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
	},
	appleWebApp: {
		capable: true,
		// Opaque bar, not black-translucent: translucent lets light-mode content
		// show through and washes out the white status-bar icons.
		statusBarStyle: 'black',
		title: 'ManaWG',
	},
	formatDetection: {
		telephone: false,
	},
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
	// Keep fixed bottom chrome (chat composer, bottom nav) above the Android
	// keyboard by resizing the whole layout, matching iOS keyboard behavior.
	// Default 'resizes-visual' would let the keyboard overlay them.
	interactiveWidget: 'resizes-content',
	// The app icon and system chrome use the brand's Neutral 950.
	themeColor: '#0a0a0a',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	// The CSP only allows scripts with the per-request nonce from the middleware.
	const nonce = (await headers()).get('x-nonce') ?? undefined;
	const [locale, t, messages] = await Promise.all([
		getLocale(),
		getTranslations('common'),
		getMessages(),
	]);
	return (
		<html
			lang={htmlLang(locale)}
			suppressHydrationWarning
			className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
		>
			<head>
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black" />
				<meta name="apple-mobile-web-app-title" content="ManaWG" />
				<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
				{/* Catch the beforeinstallprompt event very early, before React mounts.
				    The browser fires it only once; without this catcher, components
				    that mount late lose it entirely. */}
				<Script id="manawg-install-ready" strategy="beforeInteractive">
					{`(function(){if(typeof window==='undefined')return;window.__manawgDeferredInstallEvent=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__manawgDeferredInstallEvent=e;window.dispatchEvent(new CustomEvent('manawg:install-ready'));});})();`}
				</Script>
				{/* Anti-flicker theme bootstrap. A plain inline script in <head> runs before first paint;
            next/script beforeInteractive only queues it until the runtime chunks have loaded, so
            slow networks showed a white page on dark devices. The browser hides the nonce attribute
            from the client, hence suppressHydrationWarning. */}
				<script
					nonce={nonce}
					suppressHydrationWarning
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static constant, no dynamic data
					dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
				/>
				<script
					nonce={nonce}
					suppressHydrationWarning
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static constant, no dynamic data
					dangerouslySetInnerHTML={{ __html: SPLASH_BOOTSTRAP_SCRIPT }}
				/>
				{/* Plain <script>, not next/script: next/script injects after hydration, so the JSON-LD
				    never appeared in the server HTML crawlers read. Static JSON.stringify of constants, no XSS surface. */}
				{IS_OFFICIAL_INSTANCE && (
					<script
						type="application/ld+json"
						nonce={nonce}
						suppressHydrationWarning
						// biome-ignore lint/security/noDangerouslySetInnerHtml: static constant, no dynamic data
						dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema) }}
					/>
				)}
			</head>
			<body suppressHydrationWarning>
				<NextIntlClientProvider messages={pickMessages(messages, ROOT_CLIENT_NAMESPACES)}>
					{/* WCAG 2.4.1 Bypass Blocks — keyboard-only skip link.
					    Targets the <main id="main"> rendered by per-route layouts. */}
					<a href="#main" className="skip-link">
						{t('skipToContent')}
					</a>
					<SplashScreen />
					<InputModality />
					<DeviceLocaleSync />
					<ThemeProvider>
						<GoogleSignInProvider enabled={process.env.GOOGLE_SIGN_IN?.trim() !== 'false'}>
							{/* Phone column on every screen; wider viewports show backdrop
							    and a hairline edge around it. */}
							<div
								data-app-frame
								className="relative mx-auto min-h-svh w-full max-w-[var(--app-frame-width)] overflow-x-clip bg-background min-[30rem]:border-x print:max-w-none print:border-x-0"
								style={{ paddingBottom: 'var(--install-prompt-space, 0px)' }}
							>
								{children}
								<PwaRegister />
								<InstallPrompt />
							</div>
						</GoogleSignInProvider>
					</ThemeProvider>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}

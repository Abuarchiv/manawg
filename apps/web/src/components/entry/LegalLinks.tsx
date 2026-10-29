import { useLocale, useTranslations } from 'next-intl';
import { LanguageSwitch } from '@/components/app/LanguageSwitch';
import { richArgument } from '@/components/entry/rich-argument';
import type { Locale } from '@/shared/i18n/locale';
import { cn } from '@/shared/lib/cn';
import { IS_OFFICIAL_INSTANCE, landingUrl, legalUrl } from '@/shared/lib/landing-url';

type LegalLabel = 'about' | 'imprint' | 'privacy' | 'terms';
interface LegalLink {
	href: string;
	label: LegalLabel;
}

const legalLink = (href: string | null, label: LegalLabel): LegalLink[] =>
	href ? [{ href, label }] : [];

// English readers get the English pages of the official landing.
const LANDING_PAGES = {
	about: { de: '/ueber-manawg', en: '/en/about-manawg' },
	flatApp: { de: '/wg-app', en: '/en/flat-share-app' },
	guide: { de: '/ratgeber', en: '/en/guides' },
} as const;

// The operator's legal pages are absent when the instance has none configured.
function linksFor(locale: Locale) {
	const privacy = legalUrl('/datenschutz', locale);
	const terms = legalUrl('/agb', locale);
	const imprintOnly = legalLink(legalUrl('/impressum', locale), 'imprint');
	return {
		privacy,
		terms,
		imprintOnly,
		legal: [
			{ href: landingUrl(LANDING_PAGES.about[locale]), label: 'about' as const },
			...imprintOnly,
			...legalLink(privacy, 'privacy'),
			...legalLink(terms, 'terms'),
		],
		// Product and guide pages of the official landing; shown only there and on the plain entry
		// footer, never in consent or registration flows (those keep the legal minimum).
		info: IS_OFFICIAL_INSTANCE
			? [
					{ href: landingUrl(LANDING_PAGES.flatApp[locale]), label: 'flatApp' as const },
					{ href: landingUrl(LANDING_PAGES.guide[locale]), label: 'guide' as const },
				]
			: [],
	};
}

const CONSENT_LINK = '-my-3.5 inline-block py-3.5 underline underline-offset-4';

// Public entry and sign-up must reach the legal pages without an account (§ 5 DDG, Art. 13 DSGVO).
export function LegalLinks({
	consent = false,
	registration = false,
	className,
}: {
	consent?: boolean;
	registration?: boolean;
	className?: string;
}) {
	const t = useTranslations('entry.legal');
	const links = linksFor(useLocale() as Locale);
	const AGB = links.terms;
	const PRIVACY = links.privacy;
	const INFO_LINKS = links.info;
	const legalLinks = consent || registration ? links.imprintOnly : links.legal;
	return (
		<footer
			className={cn(
				'flex flex-col items-center gap-1 text-center text-xs text-muted-foreground',
				className,
			)}
		>
			{(consent || registration) && AGB && PRIVACY && (
				<p>
					{t.rich(registration ? 'consentRegister' : 'consentSignIn', {
						terms: richArgument(
							<a href={AGB} className={CONSENT_LINK}>
								{t('consentTerms')}
							</a>,
						),
						privacy: richArgument(
							<a href={PRIVACY} className={CONSENT_LINK}>
								{t('consentPrivacy')}
							</a>,
						),
					})}
				</p>
			)}
			{!consent && !registration && INFO_LINKS.length > 0 && (
				<nav aria-label={t('moreNav')} className="flex flex-wrap justify-center">
					{INFO_LINKS.map((link) => (
						<a
							key={link.href}
							href={link.href}
							className="inline-flex min-h-11 items-center px-2 underline-offset-4 hover:underline"
						>
							{t(link.label)}
						</a>
					))}
				</nav>
			)}
			{legalLinks.length > 0 && (
				<nav aria-label={t('legalNav')} className="flex flex-wrap justify-center">
					{legalLinks.map((link) => (
						<a
							key={link.href}
							href={link.href}
							className="inline-flex min-h-11 items-center px-2 underline-offset-4 hover:underline"
						>
							{t(link.label)}
						</a>
					))}
				</nav>
			)}
			<LanguageSwitch variant="links" />
		</footer>
	);
}

import { useTranslations } from 'next-intl';
import { LanguageSwitch } from '@/components/app/LanguageSwitch';
import { richArgument } from '@/components/entry/rich-argument';
import { cn } from '@/shared/lib/cn';
import { IS_OFFICIAL_INSTANCE, landingUrl, legalUrl } from '@/shared/lib/landing-url';

type LegalLabel = 'about' | 'imprint' | 'privacy' | 'terms';
interface LegalLink {
	href: string;
	label: LegalLabel;
}

// The operator's legal pages are absent when the instance has none configured.
const PRIVACY = legalUrl('/datenschutz');
const AGB = legalUrl('/agb');
const legalLink = (href: string | null, label: LegalLabel): LegalLink[] =>
	href ? [{ href, label }] : [];
const IMPRINT_ONLY = legalLink(legalUrl('/impressum'), 'imprint');
const LEGAL_LINKS: LegalLink[] = [
	{ href: landingUrl('/ueber-manawg'), label: 'about' },
	...IMPRINT_ONLY,
	...legalLink(PRIVACY, 'privacy'),
	...legalLink(AGB, 'terms'),
];
// Product and guide pages of the official landing; shown only there and on the plain entry
// footer, never in consent or registration flows (those keep the legal minimum).
const INFO_LINKS = IS_OFFICIAL_INSTANCE
	? ([
			{ href: landingUrl('/wg-app'), label: 'flatApp' },
			{ href: landingUrl('/ratgeber'), label: 'guide' },
		] as const)
	: [];

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
	const legalLinks = consent || registration ? IMPRINT_ONLY : LEGAL_LINKS;
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

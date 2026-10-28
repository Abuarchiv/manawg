import { useTranslations } from 'next-intl';
import { LanguageSwitch } from '@/components/app/LanguageSwitch';
import { richArgument } from '@/components/entry/rich-argument';
import { cn } from '@/shared/lib/cn';
import { landingUrl, legalUrl } from '@/shared/lib/landing-url';

const LEGAL_LINKS = [
	{ href: landingUrl('/ueber-manawg'), label: 'about' },
	{ href: legalUrl('/impressum'), label: 'imprint' },
	{ href: legalUrl('/datenschutz'), label: 'privacy' },
	{ href: legalUrl('/agb'), label: 'terms' },
] as const;
const [, IMPRESSUM, DATENSCHUTZ, AGB] = LEGAL_LINKS;
// Product and guide pages live on the landing; shown only on the plain entry footer,
// never in consent or registration flows (those keep the legal minimum).
const INFO_LINKS = [
	{ href: landingUrl('/wg-app'), label: 'flatApp' },
	{ href: landingUrl('/ratgeber'), label: 'guide' },
] as const;

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
	return (
		<footer
			className={cn(
				'flex flex-col items-center gap-1 text-center text-xs text-muted-foreground',
				className,
			)}
		>
			{(consent || registration) && (
				<p>
					{t.rich(registration ? 'consentRegister' : 'consentSignIn', {
						terms: richArgument(
							<a href={AGB.href} className={CONSENT_LINK}>
								{t('consentTerms')}
							</a>,
						),
						privacy: richArgument(
							<a href={DATENSCHUTZ.href} className={CONSENT_LINK}>
								{t('consentPrivacy')}
							</a>,
						),
					})}
				</p>
			)}
			{!consent && !registration && (
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
			<nav aria-label={t('legalNav')} className="flex flex-wrap justify-center">
				{(consent || registration ? [IMPRESSUM] : LEGAL_LINKS).map((link) => (
					<a
						key={link.href}
						href={link.href}
						className="inline-flex min-h-11 items-center px-2 underline-offset-4 hover:underline"
					>
						{t(link.label)}
					</a>
				))}
			</nav>
			<LanguageSwitch variant="links" />
		</footer>
	);
}

import { cn } from '@/shared/lib/cn';
import { landingUrl } from '@/shared/lib/landing-url';

const LEGAL_LINKS = [
	{ href: landingUrl('/ueber-manawg'), label: 'Über ManaWG' },
	{ href: landingUrl('/impressum'), label: 'Impressum' },
	{ href: landingUrl('/datenschutz'), label: 'Datenschutz' },
	{ href: landingUrl('/agb'), label: 'AGB' },
] as const;
const [, IMPRESSUM, DATENSCHUTZ, AGB] = LEGAL_LINKS;
// Product and guide pages live on the landing; shown only on the plain entry footer,
// never in consent or registration flows (those keep the legal minimum).
const INFO_LINKS = [
	{ href: landingUrl('/wg-app'), label: 'Die WG-App' },
	{ href: landingUrl('/ratgeber'), label: 'WG-Ratgeber' },
] as const;

// Public entry and sign-up must reach the legal pages without an account (§ 5 DDG, Art. 13 DSGVO).
export function LegalLinks({
	consent = false,
	registration = false,
	className,
}: { consent?: boolean; registration?: boolean; className?: string }) {
	return (
		<footer
			className={cn(
				'flex flex-col items-center gap-1 text-center text-[13px] text-muted-foreground',
				className,
			)}
		>
			{(consent || registration) && (
				<p>
					Mit der {registration ? 'Registrierung' : 'Anmeldung'} akzeptierst du unsere{' '}
					<a href={AGB.href} className="-my-3.5 inline-block py-3.5 underline underline-offset-4">
						AGB
					</a>{' '}
					und die{' '}
					<a
						href={DATENSCHUTZ.href}
						className="-my-3.5 inline-block py-3.5 underline underline-offset-4"
					>
						Datenschutzerklärung
					</a>
					.
				</p>
			)}
			{!consent && !registration && (
				<nav aria-label="Mehr zu ManaWG" className="flex flex-wrap justify-center">
					{INFO_LINKS.map((link) => (
						<a
							key={link.href}
							href={link.href}
							className="inline-flex min-h-11 items-center px-2 underline-offset-4 hover:underline"
						>
							{link.label}
						</a>
					))}
				</nav>
			)}
			<nav aria-label="Rechtliches" className="flex flex-wrap justify-center">
				{(consent || registration ? [IMPRESSUM] : LEGAL_LINKS).map((link) => (
					<a
						key={link.href}
						href={link.href}
						className="inline-flex min-h-11 items-center px-2 underline-offset-4 hover:underline"
					>
						{link.label}
					</a>
				))}
			</nav>
		</footer>
	);
}

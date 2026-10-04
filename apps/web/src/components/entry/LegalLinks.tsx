import { cn } from '@/shared/lib/cn';

const LEGAL_LINKS = [
	{ href: 'https://manawg.com/impressum', label: 'Impressum' },
	{ href: 'https://manawg.com/datenschutz', label: 'Datenschutz' },
	{ href: 'https://manawg.com/agb', label: 'AGB' },
] as const;

// Public entry and sign-up must reach the legal pages without an account (§ 5 DDG, Art. 13 DSGVO).
export function LegalLinks({
	consent = false,
	className,
}: { consent?: boolean; className?: string }) {
	return (
		<footer
			className={cn(
				'flex flex-col items-center gap-1 text-center text-[13px] text-muted-foreground',
				className,
			)}
		>
			{consent && <p>Mit der Anmeldung akzeptierst du unsere AGB und die Datenschutzerklärung.</p>}
			<nav aria-label="Rechtliches" className="flex flex-wrap justify-center">
				{LEGAL_LINKS.map((link) => (
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

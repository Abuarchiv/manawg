import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface BackLinkProps {
	href: string;
	/** Ziel im Klartext, z. B. "Ausgaben" — wird zu "Zurück zu Ausgaben". */
	label: string;
}

/**
 * Rücksprung einer Unterseite auf ihre Modulseite. Unterseiten hängen nicht
 * mehr in der Hauptnavigation, deshalb ist das hier der einzige Weg zurück
 * und muss auf jeder von ihnen stehen.
 */
export function BackLink({ href, label }: BackLinkProps) {
	return (
		<Link
			href={href}
			aria-label={`Zurück zu ${label}`}
			className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
		>
			<ArrowLeft className="h-4 w-4" aria-hidden />
		</Link>
	);
}

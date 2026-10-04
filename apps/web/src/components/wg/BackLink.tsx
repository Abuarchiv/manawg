import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
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
			className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), '-ml-2')}
		>
			<ArrowLeft aria-hidden />
			<span className="sr-only">Zurück zu {label}</span>
		</Link>
	);
}

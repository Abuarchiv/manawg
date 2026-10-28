import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';

interface BackLinkProps {
	href: string;
	/** Target in plain words, e.g. "Ausgaben"; becomes "Zurück zu Ausgaben". */
	label: string;
}

/**
 * Back link from a subpage to its module page. Subpages are not in the main
 * navigation, so this is the only way back and must appear on every one of them.
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

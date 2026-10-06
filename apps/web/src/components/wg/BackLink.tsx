import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface BackLinkProps {
	href: string;
	/** Plain-text target, e.g. "Ausgaben", rendered as "Zurück zu Ausgaben". */
	label: string;
}

/**
 * Link from a subpage back to its module page. Subpages are not part of the
 * main navigation, so this is the only way back and every one of them needs it.
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

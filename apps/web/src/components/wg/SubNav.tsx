import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

export interface SubNavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	/** Optional Zähler, z. B. Anzahl offener Mahnungen. 0 wird nicht gerendert. */
	count?: number;
}

interface SubNavProps {
	/** Beschreibt der Vorlesesoftware, wozu die Unterbereiche gehören. */
	label: string;
	items: SubNavItem[];
}

/**
 * Unterbereiche einer Modulseite (Ausgaben → Fixkosten/Mahnungen,
 * Einkauf → Vorräte). Bewusst als Navigation und nicht als Button-Reihe
 * gestaltet: es sind Orte, keine Aktionen — die Primäraktion der Seite
 * soll die einzige gefüllte Schaltfläche bleiben.
 */
export function SubNav({ label, items }: SubNavProps) {
	if (items.length === 0) return null;

	return (
		<nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
			<ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
				{items.map(({ href, label: itemLabel, icon: Icon, count }) => (
					<li key={href}>
						<Link
							href={href}
							className="inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3.5 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
							{itemLabel}
							{typeof count === 'number' && count > 0 && (
								<span className="ml-0.5 rounded-full bg-[var(--surface)] px-1.5 text-[11px] tabular-nums text-[var(--text-3)]">
									{count}
								</span>
							)}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

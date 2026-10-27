'use client';
import type { getChorePlanHealth } from '@/features/chores/chore-status';
import { pluralize } from '@/shared/lib/plural';

interface PutzenHeaderProps {
	itemCount: number;
	loading: boolean;
	health: ReturnType<typeof getChorePlanHealth> | null;
}

export function PutzenHeader({ itemCount, loading, health }: PutzenHeaderProps) {
	return (
		// The active tab already names the page; title and count stay for screen readers.
		<header className="sr-only">
			<h1>Putzplan</h1>
			<p aria-live="polite" aria-atomic="true">
				{loading
					? 'Lädt…'
					: [
							pluralize(itemCount, 'Aufgabe', 'Aufgaben'),
							health?.gaps ? `${health.gaps} überfällig` : null,
							health?.dueToday ? `${health.dueToday} heute` : null,
						]
							.filter(Boolean)
							.join(' · ')}
			</p>
		</header>
	);
}

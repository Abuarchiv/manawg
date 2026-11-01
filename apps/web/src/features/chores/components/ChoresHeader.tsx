'use client';
import { useTranslations } from 'next-intl';
import type { getChorePlanHealth } from '@/features/chores/chore-status';

/** Focus target when a completed chore leaves the section its button was in. */
export const CHORES_HEADING_ID = 'chores-heading';

interface ChoresHeaderProps {
	itemCount: number;
	loading: boolean;
	health: ReturnType<typeof getChorePlanHealth> | null;
}

export function ChoresHeader({ itemCount, loading, health }: ChoresHeaderProps) {
	const t = useTranslations('chores.header');
	const common = useTranslations('common');
	return (
		// The active tab already names the page; title and count stay for screen readers.
		<header className="sr-only">
			<h1 id={CHORES_HEADING_ID} tabIndex={-1}>
				{t('title')}
			</h1>
			<p aria-live="polite" aria-atomic="true">
				{loading
					? common('loading')
					: [
							t('tasks', { count: itemCount }),
							health?.gaps ? t('overdue', { count: String(health.gaps) }) : null,
							health?.dueToday ? t('dueToday', { count: String(health.dueToday) }) : null,
						]
							.filter(Boolean)
							.join(' · ')}
			</p>
		</header>
	);
}

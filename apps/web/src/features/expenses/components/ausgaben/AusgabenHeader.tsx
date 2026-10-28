'use client';

import { useTranslations } from 'next-intl';

interface AusgabenHeaderProps {
	expenseCount: number;
	initialLoading: boolean;
}

export function AusgabenHeader({
	expenseCount,
	initialLoading,
}: AusgabenHeaderProps): React.ReactElement {
	const t = useTranslations('expenses.page');
	return (
		// The active tab already names the page; title and count stay for screen readers.
		<header className="sr-only">
			<h1>{t('title')}</h1>
			<p aria-live="polite" aria-atomic="true">
				{initialLoading ? '' : t('entryCount', { count: expenseCount })}
			</p>
		</header>
	);
}

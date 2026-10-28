'use client';

import { useTranslations } from 'next-intl';

interface ExpensesHeaderProps {
	expenseCount: number;
	initialLoading: boolean;
}

export function ExpensesHeader({
	expenseCount,
	initialLoading,
}: ExpensesHeaderProps): React.ReactElement {
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

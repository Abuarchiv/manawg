'use client';

interface AusgabenHeaderProps {
	expenseCount: number;
	initialLoading: boolean;
}

export function AusgabenHeader({
	expenseCount,
	initialLoading,
}: AusgabenHeaderProps): React.ReactElement {
	return (
		// The active tab already names the page; title and count stay for screen readers.
		<header className="sr-only">
			<h1>Ausgaben</h1>
			<p aria-live="polite" aria-atomic="true">
				{initialLoading ? '' : `${expenseCount} ${expenseCount === 1 ? 'Eintrag' : 'Einträge'}`}
			</p>
		</header>
	);
}

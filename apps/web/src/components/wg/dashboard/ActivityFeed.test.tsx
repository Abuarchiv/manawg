import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityFeed } from './ActivityFeed';

describe('ActivityFeed', () => {
	it('renders the empty-state start action as a touch-sized control', () => {
		render(<ActivityFeed items={[]} emptyHref="/wg/MTE8PZAT/pinnwand" />);

		expect(screen.getByRole('link', { name: 'Erste Aktion starten' })).toHaveClass('h-11');
	});

	it('keeps long audit details readable and available in full', () => {
		const detail =
			'Internet · 32,90 EUR · 2 Aufteilungen · monatlich · nächste Fälligkeit 18.06. · Ruhezeit 22-7 Uhr';

		render(
			<ActivityFeed
				items={[
					{
						kind: 'audit',
						timestamp: '2026-05-18T12:00:00.000Z',
						memberName: 'Ava',
						text: 'hat Fixkosten und Benachrichtigungen aktualisiert.',
						detail,
					},
				]}
			/>,
		);

		const detailNode = screen.getByText(detail);
		expect(detailNode).toHaveClass('line-clamp-2');
		expect(detailNode).not.toHaveClass('truncate');
		expect(detailNode).toHaveAttribute('title', detail);
	});
});

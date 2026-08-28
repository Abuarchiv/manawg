import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BalanceBars } from './BalanceBars';

describe('BalanceBars', () => {
	it('renders the empty-state expense action as a touch-sized control', () => {
		render(<BalanceBars balances={[]} currentMemberId="member-1" emptyHref="/wg/demo/ausgaben" />);

		expect(screen.getByRole('link', { name: 'Erste Ausgabe eintragen' })).toHaveClass('h-11');
	});
});

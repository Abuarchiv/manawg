import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WgNotFound from './not-found';

describe('WgNotFound', () => {
	it('renders the recovery link as a touch-sized control', () => {
		render(<WgNotFound />);

		expect(screen.getByRole('link', { name: 'Neue WG erstellen oder beitreten' })).toHaveClass(
			'h-11',
		);
	});
});

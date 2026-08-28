import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WgError from './error';

vi.mock('@/lib/observability', () => ({
	captureException: vi.fn(),
}));

describe('WgError', () => {
	it('renders recovery actions as touch-sized controls', () => {
		render(<WgError error={new Error('kaputt')} reset={vi.fn()} />);

		expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toHaveClass('h-11');
		expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveClass('h-11');
	});
});

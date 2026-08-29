import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WgTopBar } from './WgTopBar';

const navigationMock = vi.hoisted(() => ({
	pathname: '/wg/WG%2F123%3Fx%3D1/ausgaben',
}));

vi.mock('next/navigation', () => ({
	usePathname: () => navigationMock.pathname,
}));

vi.mock('@/components/wg/ChatTopBarLink', () => ({
	ChatTopBarLink: ({ className }: { className?: string }) => (
		<a href="#chat" className={className} aria-label="Chat öffnen">
			Chat
		</a>
	),
}));

vi.mock('@/shared/components/theme/ThemeToggle', () => ({
	ThemeToggle: ({ className }: { className?: string }) => (
		<button type="button" className={className}>
			Theme
		</button>
	),
}));

describe('WgTopBar', () => {
	it('encodes decoded WG codes in quick-access links', () => {
		render(<WgTopBar code="WG/123?x=1" />);

		expect(screen.getByRole('link', { name: 'Aktivitätschronik öffnen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/aktivitaet',
		);
		expect(screen.getByRole('link', { name: 'WG durchsuchen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/suche',
		);
	});

	it('renders quick-access actions as touch-sized controls', () => {
		render(<WgTopBar code="WG/123?x=1" />);

		expect(screen.getByRole('link', { name: 'Aktivitätschronik öffnen' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(screen.getByRole('link', { name: 'WG durchsuchen' })).toHaveClass('h-11', 'w-11');
		expect(screen.getByRole('button', { name: 'Theme' })).toHaveClass('h-11', 'w-11');
	});
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SocialLoginButtons, type SocialProvider } from './SocialLoginButtons';

const providers: Array<{ provider: SocialProvider; label: string }> = [
	{ provider: 'google', label: 'Mit Google anmelden' },
	{ provider: 'apple', label: 'Mit Apple anmelden' },
	{ provider: 'facebook', label: 'Mit Facebook anmelden' },
];

describe('SocialLoginButtons', () => {
	it('zeigt Google, Apple und Facebook als mobile, klar beschriftete Buttons', () => {
		render(<SocialLoginButtons onOAuthStart={vi.fn()} />);

		for (const { label } of providers) {
			const button = screen.getByRole('button', { name: label });
			expect(button).toHaveClass('min-h-11', 'w-full');
			expect(button).toHaveAttribute('type', 'button');
		}
	});

	it('übergibt den Anbieter und next an den injizierten OAuth-Start', () => {
		const onOAuthStart = vi.fn(() => Promise.resolve());
		render(<SocialLoginButtons next="/wg/sonnenhof" onOAuthStart={onOAuthStart} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mit Apple anmelden' }));

		expect(onOAuthStart).toHaveBeenCalledWith('apple', '/wg/sonnenhof');
	});

	it('beschriftet die Buttons beim Verknüpfen eindeutig', () => {
		render(<SocialLoginButtons variant="link" onOAuthStart={vi.fn()} />);

		expect(screen.getByRole('group', { name: 'Social Login verknüpfen' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Google verknüpfen' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Apple verknüpfen' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Facebook verknüpfen' })).toBeVisible();
	});

	it('verwendet / als sicheren Standard für next', () => {
		const onOAuthStart = vi.fn(() => Promise.resolve());
		render(<SocialLoginButtons onOAuthStart={onOAuthStart} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mit Google anmelden' }));

		expect(onOAuthStart).toHaveBeenCalledWith('google', '/');
	});

	it('sperrt alle Anbieter und zeigt den Ladezustand während des OAuth-Starts', () => {
		let resolveStart!: () => void;
		const onOAuthStart = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveStart = resolve;
				}),
		);
		render(<SocialLoginButtons onOAuthStart={onOAuthStart} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mit Google anmelden' }));

		expect(screen.getByRole('group', { name: 'Mit Social Login anmelden' })).toHaveAttribute(
			'aria-busy',
			'true',
		);
		expect(screen.getByRole('status')).toHaveTextContent('Google');
		for (const { label } of providers) {
			expect(screen.getByRole('button', { name: label })).toBeDisabled();
		}

		resolveStart();
	});

	it('zeigt einen verständlichen Fehler und kann danach erneut gestartet werden', async () => {
		const onOAuthStart = vi.fn().mockRejectedValue(new Error('provider unavailable'));
		render(<SocialLoginButtons onOAuthStart={onOAuthStart} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mit Facebook anmelden' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Anmeldung konnte nicht gestartet werden.',
		);
		expect(screen.getByRole('button', { name: 'Mit Facebook anmelden' })).not.toBeDisabled();
		await waitFor(() =>
			expect(screen.getByRole('group', { name: 'Mit Social Login anmelden' })).toHaveAttribute(
				'aria-busy',
				'false',
			),
		);
	});
});

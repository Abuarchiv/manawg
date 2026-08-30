import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from './install-prompt';

const navigationMock = vi.hoisted(() => ({ pathname: '/wg/ABCD1234/chat' }));

vi.mock('next/navigation', () => ({
	usePathname: () => navigationMock.pathname,
}));

function fireBeforeInstallPrompt() {
	const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
		prompt: () => Promise.resolve(),
		userChoice: Promise.resolve({ outcome: 'accepted' as const }),
	});
	window.dispatchEvent(event);
}

describe('InstallPrompt', () => {
	afterEach(() => {
		window.localStorage.clear();
		vi.useRealTimers();
	});

	it('does not pop over a focused composer input and appears once focus moves away', async () => {
		vi.useFakeTimers();
		render(
			<>
				<InstallPrompt />
				<input aria-label="Nachricht schreiben" />
			</>,
		);
		screen.getByLabelText('Nachricht schreiben').focus();

		act(() => {
			fireBeforeInstallPrompt();
		});
		act(() => {
			vi.advanceTimersByTime(1300);
		});
		expect(screen.queryByRole('status', { name: 'App installieren' })).not.toBeInTheDocument();

		act(() => {
			screen.getByLabelText('Nachricht schreiben').blur();
			fireBeforeInstallPrompt();
		});
		expect(screen.getByRole('status', { name: 'App installieren' })).toBeInTheDocument();
	});
});

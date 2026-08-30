import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

const offlineClientMock = vi.hoisted(() => ({
	countOfflineActions: vi.fn(),
	syncOfflineActions: vi.fn(),
}));
const wgContextMock = vi.hoisted(() => ({
	shareCode: 'MTE8PZAT',
	memberId: 'member-1',
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: { shareCode: wgContextMock.shareCode },
		identity: { memberId: wgContextMock.memberId, name: 'Ava' },
	}),
}));

vi.mock('@/core/offline/offline-client', async (importOriginal) => {
	// `getSyncedCountForWg` is pure (just reads `event.detail`) — keep the real
	// implementation so these tests exercise the same parsing the component
	// uses in production, instead of a hand-rolled copy that could drift.
	const actual = await importOriginal<typeof import('@/core/offline/offline-client')>();
	return {
		...actual,
		countOfflineActions: (...args: unknown[]) => offlineClientMock.countOfflineActions(...args),
		syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
	};
});

describe('OfflineBanner', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		wgContextMock.shareCode = 'MTE8PZAT';
		wgContextMock.memberId = 'member-1';
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
		offlineClientMock.countOfflineActions.mockReturnValue(0);
	});

	it('keeps the automatic sync success notice visible when the queue becomes empty', async () => {
		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(new CustomEvent('manawg:offline-synced', { detail: { synced: 2 } }));
		});

		expect(screen.getByText('2 Offline-Aktionen synchronisiert.')).toBeVisible();
		expect(screen.getByRole('status')).toHaveTextContent('2 Offline-Aktionen synchronisiert.');
	});

	it('keeps automatic sync notice honest when actions remain queued', async () => {
		offlineClientMock.countOfflineActions.mockReturnValueOnce(2).mockReturnValueOnce(1);

		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(new CustomEvent('manawg:offline-synced', { detail: { synced: 1 } }));
		});

		expect(
			screen.getByText('1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.'),
		).toBeVisible();
		expect(screen.getByRole('status')).toHaveTextContent(
			'1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.',
		);
	});

	it('clears partial sync notices when the queue changes again', async () => {
		offlineClientMock.countOfflineActions
			.mockReturnValueOnce(2)
			.mockReturnValueOnce(1)
			.mockReturnValueOnce(1)
			.mockReturnValueOnce(2);

		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { MTE8PZAT: 1 } },
				}),
			);
		});
		expect(
			screen.getByText('1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.'),
		).toBeVisible();

		await act(async () => {
			window.dispatchEvent(new CustomEvent('manawg:offline-queue'));
		});

		expect(
			screen.queryByText('1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.'),
		).not.toBeInTheDocument();
		expect(screen.getByText('2 Offline-Aktionen warten auf Synchronisierung.')).toBeVisible();
	});

	it('ignores automatic sync notices for other WGs', async () => {
		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { OTHERWG1: 1 } },
				}),
			);
		});

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('keeps the current WG notice when another WG syncs later', async () => {
		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { MTE8PZAT: 1 } },
				}),
			);
		});
		expect(screen.getByText('1 Offline-Aktion synchronisiert.')).toBeVisible();

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { OTHERWG1: 1 } },
				}),
			);
		});

		expect(screen.getByText('1 Offline-Aktion synchronisiert.')).toBeVisible();
	});

	it('keeps the current WG notice when a scoped sync reports zero for this WG', async () => {
		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { MTE8PZAT: 1 } },
				}),
			);
		});
		expect(screen.getByText('1 Offline-Aktion synchronisiert.')).toBeVisible();

		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { MTE8PZAT: 0, OTHERWG1: 1 } },
				}),
			);
		});

		expect(screen.getByText('1 Offline-Aktion synchronisiert.')).toBeVisible();
	});

	it('clears stale notices when the queue changes and stays empty without a sync result', async () => {
		render(<OfflineBanner />);

		await act(async () => {
			window.dispatchEvent(new CustomEvent('manawg:offline-synced', { detail: { synced: 1 } }));
		});
		expect(screen.getByText('1 Offline-Aktion synchronisiert.')).toBeVisible();

		await act(async () => {
			window.dispatchEvent(new CustomEvent('manawg:offline-queue'));
		});

		expect(screen.queryByText('1 Offline-Aktion synchronisiert.')).not.toBeInTheDocument();
	});

	it('uses plural text for multiple queued actions while online', () => {
		offlineClientMock.countOfflineActions.mockReturnValue(2);
		wgContextMock.shareCode = 'WG/123?x=1';

		render(<OfflineBanner />);

		expect(screen.getByText('2 Offline-Aktionen warten auf Synchronisierung.')).toBeVisible();
		expect(
			screen.getByRole('link', { name: '2 Offline-Aktionen warten auf Synchronisierung.' }),
		).toHaveAttribute('href', '/wg/WG%2F123%3Fx%3D1/einstellungen#daten');
		expect(screen.getByRole('status')).toHaveTextContent(
			'2 Offline-Aktionen warten auf Synchronisierung.',
		);
	});

	it('renders the manual sync action as a touch-sized control', () => {
		offlineClientMock.countOfflineActions.mockReturnValue(1);

		render(<OfflineBanner />);

		expect(screen.getByRole('button', { name: 'Offline-Aktionen jetzt senden' })).toHaveClass(
			'h-11',
		);
	});

	it('uses plural text for multiple queued actions while offline', () => {
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
		offlineClientMock.countOfflineActions.mockReturnValue(2);

		render(<OfflineBanner />);

		expect(screen.getByText('Offline. 2 Aktionen warten.')).toBeVisible();
		expect(screen.getByRole('link', { name: 'Offline-Übersicht prüfen' })).toHaveAttribute(
			'href',
			'/offline',
		);
		expect(screen.getByRole('status')).toHaveTextContent('Offline. 2 Aktionen warten.');
	});

	it('does not start duplicate manual syncs from repeated clicks', async () => {
		offlineClientMock.countOfflineActions.mockReturnValue(1);
		offlineClientMock.syncOfflineActions.mockReturnValue(
			new Promise(() => {
				// keep request pending to test the in-handler guard
			}),
		);

		render(<OfflineBanner />);

		const sendButton = screen.getByRole('button', { name: 'Offline-Aktionen jetzt senden' });
		fireEvent.click(sendButton);
		fireEvent.click(sendButton);

		expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledTimes(1);
		expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledWith('MTE8PZAT', {
			force: true,
			memberId: 'member-1',
		});
		expect(screen.getByRole('button', { name: 'Offline-Aktionen werden gesendet' })).toBeDisabled();
	});

	it('shows a warning when manual sync throws', async () => {
		offlineClientMock.countOfflineActions.mockReturnValue(1);
		offlineClientMock.syncOfflineActions.mockRejectedValue(new Error('boom'));

		render(<OfflineBanner />);

		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt senden' }));

		expect(
			await screen.findByText(
				'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.',
			),
		).toBeVisible();
		expect(screen.getByRole('status')).toHaveTextContent(
			'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.',
		);
	});

	it('keeps manual sync notice honest when actions remain queued', async () => {
		offlineClientMock.countOfflineActions
			.mockReturnValueOnce(2)
			.mockReturnValueOnce(2)
			.mockReturnValueOnce(1);
		offlineClientMock.syncOfflineActions.mockResolvedValue(1);

		render(<OfflineBanner />);

		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt senden' }));

		expect(
			await screen.findByText('1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.'),
		).toBeVisible();
		expect(screen.getByRole('status')).toHaveTextContent(
			'1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.',
		);
	});
});

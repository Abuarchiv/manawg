import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EinstellungenPage from './page';

const routerMock = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
}));
const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
const offlineClientMock = vi.hoisted(() => ({
	readOfflineQueue: vi.fn(),
	syncOfflineActions: vi.fn(),
	writeOfflineQueue: vi.fn(),
}));
const pushSubscribeMock = vi.hoisted(() => ({
	persistExistingWebPushSubscription: vi.fn(),
	subscribeWebPush: vi.fn(),
	unsubscribeWebPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
	useRouter: () => routerMock,
}));

vi.mock('@manawg/shared/components/theme/ThemeProvider', () => ({
	useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: {
			id: 'wg-1',
			name: 'Test WG',
			shareCode: 'WG/123?X=1',
			joiningEnabled: true,
			shareCodeRotatedAt: null,
		},
		members: [{ id: 'member-1', name: 'Ava', color: null }],
		identity: { memberId: 'member-1', name: 'Ava' },
	}),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

vi.mock('@/lib/wg/offline-client', () => ({
	readOfflineQueue: (...args: unknown[]) => offlineClientMock.readOfflineQueue(...args),
	syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
	writeOfflineQueue: (...args: unknown[]) => offlineClientMock.writeOfflineQueue(...args),
}));

vi.mock('@/core/notifications/push-subscribe', () => ({
	persistExistingWebPushSubscription: (...args: unknown[]) =>
		pushSubscribeMock.persistExistingWebPushSubscription(...args),
	subscribeWebPush: (...args: unknown[]) => pushSubscribeMock.subscribeWebPush(...args),
	unsubscribeWebPush: (...args: unknown[]) => pushSubscribeMock.unsubscribeWebPush(...args),
}));

const exportPayload = {
	wg: { name: 'Test WG', shareCode: 'WG/123?X=1' },
	exportedAt: '2026-05-20T00:00:00.000Z',
	sections: {
		members: [],
		expenses: [],
		recurringExpenses: [],
		shoppingItems: [],
		chores: [],
		absences: [],
		announcements: [],
		auditEvents: [],
	},
};

describe('EinstellungenPage', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: undefined,
		});
		window.location.hash = '';
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				pushOptIn: false,
				notifyAnnouncements: true,
				notifyChores: true,
				notifyExpenses: true,
				notifyReminders: true,
				notifyShopping: true,
				notifyChat: true,
				notifyEvents: true,
				quietStartHour: null,
				quietEndHour: null,
				pushConfigured: true,
			},
		});
		offlineClientMock.readOfflineQueue.mockReturnValue([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(0);
		offlineClientMock.writeOfflineQueue.mockReturnValue(true);
		pushSubscribeMock.persistExistingWebPushSubscription.mockResolvedValue(undefined);
		pushSubscribeMock.subscribeWebPush.mockResolvedValue(undefined);
		pushSubscribeMock.unsubscribeWebPush.mockResolvedValue(undefined);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => exportPayload,
			}),
		);
	});

	it('encodes the WG code in the initial export summary request and dashboard link', async () => {
		render(<EinstellungenPage />);

		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3FX%3D1/export', {
				headers: { 'x-manawg-member-id': 'member-1' },
			}),
		);
		expect(screen.getByRole('link', { name: 'Zurück zum Dashboard' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3FX%3D1',
		);
	});

	it('encodes the WG code in notification status requests', async () => {
		window.location.hash = '#benachrichtigungen';

		render(<EinstellungenPage />);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/WG%2F123%3FX%3D1/notifications',
				{ memberId: 'member-1' },
			),
		);
	});

	it('shows reminder notification settings and saves enabling them', async () => {
		window.location.hash = '#benachrichtigungen';
		apiClientMock.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
			if (path.endsWith('/notifications') && init?.method === 'PATCH') {
				return Promise.resolve({ ok: true, data: { ok: true } });
			}
			return Promise.resolve({
				ok: true,
				data: {
					pushOptIn: false,
					notifyAnnouncements: true,
					notifyChores: true,
					notifyExpenses: true,
					notifyReminders: false,
					notifyShopping: true,
					notifyChat: true,
					notifyEvents: true,
					quietStartHour: null,
					quietEndHour: null,
					pushConfigured: true,
				},
			});
		});

		render(<EinstellungenPage />);

		const remindersToggle = await screen.findByRole('checkbox', { name: /Mahnungen/ });
		expect(remindersToggle).not.toBeChecked();

		fireEvent.click(remindersToggle);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/WG%2F123%3FX%3D1/notifications',
				{
					method: 'PATCH',
					memberId: 'member-1',
					body: JSON.stringify({ notifyReminders: true }),
				},
			),
		);
	});

	it('persists server opt-in when a live browser push subscription is discovered', async () => {
		window.location.hash = '#benachrichtigungen';
		vi.stubGlobal('PushManager', class PushManager {});
		const subscription = {
			endpoint: 'https://push.example.test/subscription-1',
		};
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				getRegistration: vi.fn().mockResolvedValue({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue(subscription),
					},
				}),
			},
		});

		render(<EinstellungenPage />);

		await screen.findByRole('button', { name: /Web Push/ });
		await waitFor(() =>
			expect(pushSubscribeMock.persistExistingWebPushSubscription).toHaveBeenCalledTimes(1),
		);
		expect(pushSubscribeMock.persistExistingWebPushSubscription).toHaveBeenCalledWith(
			'WG/123?X=1',
			'member-1',
			subscription,
		);
		expect(pushSubscribeMock.subscribeWebPush).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: /Web Push/ })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	it('keeps Web Push inactive and shows an error when subscription resync cannot be saved', async () => {
		window.location.hash = '#benachrichtigungen';
		vi.stubGlobal('PushManager', class PushManager {});
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				getRegistration: vi.fn().mockResolvedValue({
					pushManager: {
						getSubscription: vi.fn().mockResolvedValue({
							endpoint: 'https://push.example.test/subscription-1',
						}),
					},
				}),
			},
		});
		pushSubscribeMock.persistExistingWebPushSubscription.mockRejectedValue(
			new Error('Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		);

		render(<EinstellungenPage />);

		expect(
			await screen.findByText(
				'Push-Abo konnte nicht gespeichert werden: Versuche es gleich erneut.',
			),
		).toBeVisible();
		expect(pushSubscribeMock.persistExistingWebPushSubscription).toHaveBeenCalledTimes(1);
		expect(pushSubscribeMock.subscribeWebPush).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: /Web Push/ })).toHaveAttribute(
			'aria-pressed',
			'false',
		);
	});

	it('renders settings tabs as touch-sized controls', async () => {
		render(<EinstellungenPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());

		expect(screen.getByRole('tab', { name: 'Profil' })).toHaveClass('h-11');
		expect(screen.getByRole('tab', { name: 'Benachrichtigungen' })).toHaveClass('h-11');
		expect(screen.getByRole('tab', { name: 'Daten' })).toHaveClass('h-11');
	});

	it('explains export server errors as retryable failures', async () => {
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => exportPayload,
		} as Response);
		vi.mocked(fetch).mockResolvedValueOnce({
			ok: false,
			status: 500,
			json: async () => ({ error: 'server_error' }),
		} as Response);

		render(<EinstellungenPage />);
		fireEvent.click(screen.getByRole('tab', { name: 'Daten' }));
		fireEvent.click(await screen.findByRole('button', { name: 'WG-Daten als JSON exportieren' }));

		expect(
			await screen.findByText('Export konnte nicht erstellt werden: Versuche es gleich erneut.'),
		).toBeVisible();
		expect(screen.queryByText('Export konnte nicht erstellt werden.')).not.toBeInTheDocument();
	});

	it('explains access server failures as retryable failures', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => exportPayload,
			} as Response)
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				clone: () =>
					({
						json: async () => ({ error: 'db_error' }),
					}) as Response,
				json: async () => ({ error: 'db_error' }),
			} as Response);

		render(<EinstellungenPage />);
		fireEvent.click(screen.getByRole('tab', { name: 'Zugang' }));
		fireEvent.click(screen.getByRole('button', { name: 'Neue Beitritte sperren' }));

		expect(
			await screen.findByText('Zugang konnte nicht geändert werden: Versuche es gleich erneut.'),
		).toBeVisible();
		expect(screen.queryByText('Zugang konnte nicht geändert werden.')).not.toBeInTheDocument();
	});

	it('renders access control actions as touch-sized controls', async () => {
		render(<EinstellungenPage />);

		await waitFor(() => expect(fetch).toHaveBeenCalled());
		fireEvent.click(screen.getByRole('tab', { name: 'Zugang' }));

		expect(screen.getByRole('button', { name: 'Neue Beitritte sperren' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'WG-Code erneuern' })).toHaveClass('h-11');
	});

	it('explains WG deletion server failures as retryable failures', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => exportPayload,
			} as Response)
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				clone: () =>
					({
						json: async () => ({ error: 'db_error' }),
					}) as Response,
				json: async () => ({ error: 'db_error' }),
			} as Response);

		render(<EinstellungenPage />);
		fireEvent.click(screen.getByRole('tab', { name: 'Zugang' }));
		fireEvent.click(screen.getByRole('button', { name: 'Komplette WG für alle löschen' }));
		fireEvent.change(screen.getByLabelText('WG-Code zur Bestätigung'), {
			target: { value: 'WG/123?X=1' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'WG endgültig löschen' }));

		expect(
			await screen.findByText('WG konnte nicht gelöscht werden: Versuche es gleich erneut.'),
		).toBeVisible();
		expect(
			screen.queryByText('Löschen fehlgeschlagen. Bitte später erneut versuchen.'),
		).not.toBeInTheDocument();
	});

	it('explains missing notification members as stale local membership', async () => {
		window.location.hash = '#benachrichtigungen';
		apiClientMock.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
			if (path.endsWith('/notifications') && init?.method === 'PATCH') {
				return Promise.resolve({ ok: false, status: 404, error: 'member_not_found' });
			}
			return Promise.resolve({
				ok: true,
				data: {
					pushOptIn: false,
					notifyAnnouncements: true,
					notifyChores: true,
					notifyExpenses: true,
					notifyShopping: true,
					quietStartHour: null,
					quietEndHour: null,
					pushConfigured: true,
				},
			});
		});

		render(<EinstellungenPage />);

		fireEvent.click(await screen.findByRole('checkbox', { name: /Pinnwand/ }));

		expect(
			await screen.findByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Tritt der WG erneut bei.',
			),
		).toBeVisible();
		expect(
			screen.queryByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.',
			),
		).not.toBeInTheDocument();
	});

	it('explains notification save server failures as retryable failures', async () => {
		window.location.hash = '#benachrichtigungen';
		apiClientMock.apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
			if (path.endsWith('/notifications') && init?.method === 'PATCH') {
				return Promise.resolve({ ok: false, status: 500, error: 'server_error' });
			}
			return Promise.resolve({
				ok: true,
				data: {
					pushOptIn: false,
					notifyAnnouncements: true,
					notifyChores: true,
					notifyExpenses: true,
					notifyShopping: true,
					quietStartHour: null,
					quietEndHour: null,
					pushConfigured: true,
				},
			});
		});

		render(<EinstellungenPage />);

		fireEvent.click(await screen.findByRole('checkbox', { name: /Pinnwand/ }));

		expect(
			await screen.findByText(
				'Benachrichtigungen konnten nicht gespeichert werden: Versuche es gleich erneut.',
			),
		).toBeVisible();
		expect(
			screen.queryByText('Benachrichtigungseinstellung konnte nicht gespeichert werden.'),
		).not.toBeInTheDocument();
	});

	it('renders the notification status retry action as a touch-sized control', async () => {
		window.location.hash = '#benachrichtigungen';
		apiClientMock.apiFetch.mockResolvedValue({
			ok: false,
			status: 500,
			error: 'db_error',
		});

		render(<EinstellungenPage />);

		expect(await screen.findByRole('button', { name: 'Erneut laden' })).toHaveClass('h-11');
	});

	it('renders quiet-hours selects as touch-sized controls', async () => {
		window.location.hash = '#benachrichtigungen';

		render(<EinstellungenPage />);

		expect(await screen.findByLabelText('Von')).toHaveClass('h-11');
		expect(screen.getByLabelText('Bis')).toHaveClass('h-11');
	});

	it('explains test notification server failures as retryable failures', async () => {
		window.location.hash = '#benachrichtigungen';
		apiClientMock.apiFetch.mockImplementation(
			(path: string, init?: { body?: unknown; method?: string }) => {
				if (
					path.endsWith('/notifications') &&
					init?.method === 'POST' &&
					typeof init.body === 'string' &&
					init.body.includes('test_notification')
				) {
					return Promise.resolve({ ok: false, status: 500, error: 'server_error' });
				}
				return Promise.resolve({
					ok: true,
					data: {
						pushOptIn: true,
						notifyAnnouncements: true,
						notifyChores: true,
						notifyExpenses: true,
						notifyShopping: true,
						quietStartHour: null,
						quietEndHour: null,
						pushConfigured: true,
					},
				});
			},
		);

		render(<EinstellungenPage />);

		const testButton = await screen.findByRole('button', {
			name: 'Testbenachrichtigung senden',
		});
		expect(testButton).toHaveClass('h-11');

		fireEvent.click(testButton);

		expect(
			await screen.findByText(
				'Testbenachrichtigung konnte nicht gesendet werden: Versuche es gleich erneut.',
			),
		).toBeVisible();
		expect(screen.queryByText('Test konnte nicht gesendet werden.')).not.toBeInTheDocument();
	});

	it('preserves detailed Web Push deactivation errors', async () => {
		window.location.hash = '#benachrichtigungen';
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				pushOptIn: true,
				notifyAnnouncements: true,
				notifyChores: true,
				notifyExpenses: true,
				notifyShopping: true,
				quietStartHour: null,
				quietEndHour: null,
				pushConfigured: true,
			},
		});
		pushSubscribeMock.unsubscribeWebPush.mockRejectedValue(
			new Error('Push-Abo konnte nicht deaktiviert werden: Tritt der WG erneut bei.'),
		);

		render(<EinstellungenPage />);

		fireEvent.click(await screen.findByRole('button', { name: /Web Push/ }));

		expect(
			await screen.findByText('Push-Abo konnte nicht deaktiviert werden: Tritt der WG erneut bei.'),
		).toBeVisible();
		expect(screen.queryByText('Web Push konnte nicht deaktiviert werden.')).not.toBeInTheDocument();
	});

	it('renders offline queue recovery actions as touch-sized controls', async () => {
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'offline-1',
				type: 'announcement.create',
				shareCode: 'WG/123?X=1',
				memberId: 'member-1',
				createdAt: '2026-05-20T00:00:00.000Z',
				payload: {
					content: 'Müll rausstellen',
					kind: 'info',
					imageUrl: 'manawg-pending-image:abc',
				},
				attempts: 1,
				lastError: 'Anhang konnte nicht gesendet werden.',
			},
		]);

		render(<EinstellungenPage />);
		fireEvent.click(screen.getByRole('tab', { name: 'Daten' }));

		expect(
			await screen.findByRole('button', { name: 'Offline-Warteschlange erneut synchronisieren' }),
		).toHaveClass('h-11');
		expect(
			await screen.findByRole('button', { name: 'Server prüfen: Müll rausstellen' }),
		).toHaveClass('h-11');
		expect(
			screen.getByRole('button', { name: 'Offline-Aktion bearbeiten: Müll rausstellen' }),
		).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Anhang entfernen: Müll rausstellen' })).toHaveClass(
			'h-11',
		);
		expect(
			screen.getByRole('button', { name: 'Offline-Aktion verwerfen: Müll rausstellen' }),
		).toHaveClass('h-11');
	});

	it('shows and retries only the active member offline queue entries', async () => {
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'offline-member-1',
				type: 'announcement.create',
				shareCode: 'WG/123?X=1',
				memberId: 'member-1',
				createdAt: '2026-05-20T00:00:00.000Z',
				payload: {
					content: 'Ava wartet',
					kind: 'info',
					imageUrl: null,
				},
			},
			{
				id: 'offline-member-2',
				type: 'announcement.create',
				shareCode: 'WG/123?X=1',
				memberId: 'member-2',
				createdAt: '2026-05-20T00:00:00.000Z',
				payload: {
					content: 'Ben wartet',
					kind: 'info',
					imageUrl: null,
				},
			},
		]);

		render(<EinstellungenPage />);
		fireEvent.click(screen.getByRole('tab', { name: 'Daten' }));

		expect(await screen.findByText('Ava wartet')).toBeVisible();
		expect(screen.queryByText('Ben wartet')).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', { name: 'Offline-Warteschlange erneut synchronisieren' }),
		);

		await waitFor(() =>
			expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledWith('WG/123?X=1', {
				force: true,
				memberId: 'member-1',
			}),
		);
	});

	it('checks recurring advance queue entries against the current server due date', async () => {
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'recurring-advance-1',
				type: 'recurring.advance',
				shareCode: 'WG/123?X=1',
				memberId: 'member-1',
				createdAt: '2026-05-20T00:00:00.000Z',
				payload: {
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-06-20T00:00:00.000Z',
				},
			},
		]);
		apiClientMock.apiFetch.mockImplementation((path: string) => {
			if (path.endsWith('/recurring-expenses')) {
				return Promise.resolve({
					ok: true,
					data: {
						recurringExpenses: [
							{
								id: 'recurring-1',
								description: 'Internet',
								amountCents: 3290,
								nextDueAt: '2026-07-01T00:00:00.000Z',
							},
						],
					},
				});
			}
			return Promise.resolve({
				ok: true,
				data: {
					pushOptIn: false,
					notifyAnnouncements: true,
					notifyChores: true,
					notifyExpenses: true,
					notifyShopping: true,
					quietStartHour: null,
					quietEndHour: null,
					pushConfigured: true,
				},
			});
		});

		render(<EinstellungenPage />);
		fireEvent.click(screen.getByRole('tab', { name: 'Daten' }));
		fireEvent.click(
			await screen.findByRole('button', { name: 'Server prüfen: Fälligkeit nachholen' }),
		);

		expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
			'/api/wg/WG%2F123%3FX%3D1/recurring-expenses',
			{ memberId: 'member-1' },
		);
		expect(
			await screen.findByText(
				'Server-Vorlage steht inzwischen auf 1.7.2026 statt 20.6.2026. Prüfe vor dem Senden, ob die Fälligkeit schon nachgeholt wurde.',
			),
		).toBeVisible();
	});
});

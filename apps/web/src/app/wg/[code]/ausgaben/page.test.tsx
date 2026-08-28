import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AusgabenPage from './page';

const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
const offlineClientMock = vi.hoisted(() => ({
	countOfflineActions: vi.fn(),
	readOfflineQueue: vi.fn(),
	syncOfflineActions: vi.fn(),
	writeOfflineQueue: vi.fn(),
}));
const wgContextMock = vi.hoisted(() => ({
	shareCode: 'MTE8PZAT',
}));
const navigationMock = vi.hoisted(() => ({
	searchParams: '',
}));

vi.mock('next/navigation', () => ({
	useSearchParams: () => new URLSearchParams(navigationMock.searchParams),
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: {
			id: 'wg-1',
			name: 'Test WG',
			shareCode: wgContextMock.shareCode,
			joiningEnabled: true,
		},
		members: [
			{ id: 'member-1', name: 'Ava', color: null, active: true },
			{ id: 'member-2', name: 'Ben', color: null, active: true },
		],
		identity: { memberId: 'member-1', name: 'Ava' },
	}),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

vi.mock('@/lib/wg/offline-client', () => ({
	countOfflineActions: (...args: unknown[]) => offlineClientMock.countOfflineActions(...args),
	enqueueOfflineAction: vi.fn(),
	readOfflineQueue: (...args: unknown[]) => offlineClientMock.readOfflineQueue(...args),
	syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
	writeOfflineQueue: (...args: unknown[]) => offlineClientMock.writeOfflineQueue(...args),
}));

describe('AusgabenPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		wgContextMock.shareCode = 'MTE8PZAT';
		navigationMock.searchParams = '';
		Element.prototype.scrollIntoView = vi.fn();
		apiClientMock.apiFetch.mockResolvedValue({ ok: true, data: { expenses: [] } });
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			return Promise.resolve({ ok: true, data: { expenses: [] } });
		});
		offlineClientMock.countOfflineActions.mockReturnValue(0);
		offlineClientMock.readOfflineQueue.mockReturnValue([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(0);
		offlineClientMock.writeOfflineQueue.mockReturnValue(true);
	});

	it('encodes the WG code in expense API calls and header links', async () => {
		wgContextMock.shareCode = 'WG/123?x=1';

		render(<AusgabenPage />);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/expenses', {
				memberId: 'member-1',
			}),
		);
		expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
			'/api/wg/WG%2F123%3Fx%3D1/recurring-expenses',
			{ memberId: 'member-1' },
		);
		expect(screen.getByRole('link', { name: 'Verlauf' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/aktivitaet',
		);
		expect(screen.getByRole('button', { name: 'Ausgaben aktualisieren' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(screen.getByRole('link', { name: 'Verlauf' })).toHaveClass('h-11');
		expect(screen.getByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/einstellungen',
		);
		expect(screen.getByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveClass(
			'h-11',
			'w-11',
		);
	});

	it('announces manual refresh progress as a polite status update', async () => {
		render(<AusgabenPage />);

		const refreshButton = await screen.findByRole('button', { name: 'Ausgaben aktualisieren' });
		await waitFor(() => expect(refreshButton).not.toBeDisabled());

		apiClientMock.apiFetch.mockImplementation(() => new Promise(() => {}));

		fireEvent.click(refreshButton);

		const status = await screen.findByRole('status', { name: 'Aktualisieren…' });
		expect(status).toHaveAttribute('aria-live', 'polite');
		expect(status).toHaveAttribute('aria-atomic', 'true');
	});

	it('renders the load retry action as a touch-sized control', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			return Promise.resolve({ ok: false, status: 500, error: 'db_error' });
		});

		render(<AusgabenPage />);

		expect(await screen.findByRole('button', { name: 'Ausgaben erneut laden' })).toHaveClass(
			'h-11',
		);
	});

	it('renders the empty recurring-expense action as a touch-sized control', async () => {
		navigationMock.searchParams = 'filter=recurring';

		render(<AusgabenPage />);

		expect(await screen.findByRole('button', { name: 'Neue Ausgabe vorbereiten' })).toHaveClass(
			'h-11',
		);
	});

	it('renders empty expense quick-start actions as touch-sized controls', async () => {
		render(<AusgabenPage />);

		expect(await screen.findByRole('button', { name: 'Wocheneinkauf' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Putzmittel' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Internet' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Getränke' })).toHaveClass('min-h-11');
	});

	it('renders expense form segmented controls as touch-sized actions', async () => {
		render(<AusgabenPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Ausgabe erfassen' }));

		expect(screen.getByRole('button', { name: 'Aufteilung: Gleichmäßig' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Aufteilung: Manuell' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: '1 Monat' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: '2 Monate' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Quartal' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Jahr' })).toHaveClass('h-11');
	});

	it('renders expense form inputs as touch-sized controls', async () => {
		render(<AusgabenPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Ausgabe erfassen' }));

		expect(screen.getByLabelText('Beschreibung')).toHaveClass('h-11');
		expect(screen.getByLabelText('Betrag')).toHaveClass('h-11');
		expect(screen.getByLabelText('Bezahlt von')).toHaveClass('h-11');

		fireEvent.click(screen.getByRole('button', { name: 'Aufteilung: Manuell' }));

		for (const amountInput of screen.getAllByPlaceholderText('0,00')) {
			expect(amountInput).toHaveClass('h-11');
		}
	});

	it('keeps explicit zero-cent manual splits in the submitted payload', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string, options?: { method?: string }) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			if (url.endsWith('/expenses') && options?.method === 'POST') {
				return Promise.resolve({
					ok: true,
					data: {
						expense: {
							id: 'expense-1',
							description: 'Snack',
							amountCents: 1000,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
							splits: [],
						},
					},
				});
			}
			return Promise.resolve({ ok: true, data: { expenses: [] } });
		});

		render(<AusgabenPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Ausgabe erfassen' }));
		fireEvent.change(screen.getByLabelText('Beschreibung'), { target: { value: 'Snack' } });
		fireEvent.change(screen.getByLabelText('Betrag'), { target: { value: '10,00' } });
		fireEvent.click(screen.getByRole('button', { name: 'Aufteilung: Manuell' }));
		fireEvent.change(screen.getByLabelText('Anteil Ava in Euro'), { target: { value: '0,00' } });
		fireEvent.change(screen.getByLabelText('Anteil Ben in Euro'), { target: { value: '10,00' } });
		fireEvent.click(screen.getByRole('button', { name: 'Ausgabe speichern' }));

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/MTE8PZAT/expenses',
				expect.objectContaining({
					method: 'POST',
					body: expect.stringContaining('"amountCents":0'),
				}),
			),
		);
		const postCall = apiClientMock.apiFetch.mock.calls.find(
			([url, options]) => url === '/api/wg/MTE8PZAT/expenses' && options?.method === 'POST',
		);
		expect(JSON.parse(postCall?.[1]?.body as string).splits).toEqual([
			{ debtorMemberId: 'member-1', amountCents: 0 },
			{ debtorMemberId: 'member-2', amountCents: 1000 },
		]);
	});

	it('allows editing legacy expenses that have no stored split rows', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string, options?: { method?: string }) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			if (url.endsWith('/expenses/expense-legacy') && options?.method === 'PATCH') {
				return Promise.resolve({
					ok: true,
					data: {
						expense: {
							id: 'expense-legacy',
							description: 'Milch und Brot',
							amountCents: 399,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:01:00.000Z',
							splits: [],
						},
					},
				});
			}
			return Promise.resolve({
				ok: true,
				data: {
					expenses: [
						{
							id: 'expense-legacy',
							description: 'Milch',
							amountCents: 399,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
							splits: [],
						},
					],
				},
			});
		});

		render(<AusgabenPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Ausgabe bearbeiten: Milch' }));
		expect(screen.getByRole('button', { name: 'Aufteilung: Gleichmäßig' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		fireEvent.change(screen.getByLabelText('Beschreibung'), {
			target: { value: 'Milch und Brot' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Ausgabe speichern' }));

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/MTE8PZAT/expenses/expense-legacy',
				expect.objectContaining({
					method: 'PATCH',
					body: expect.stringContaining('"description":"Milch und Brot"'),
				}),
			),
		);
		expect(
			screen.queryByText('Aufteilung leer — gib mindestens einen Betrag ein.'),
		).not.toBeInTheDocument();
	});

	it('guards recurring template advancement when saving a prefilled recurring expense', async () => {
		navigationMock.searchParams = 'recurring=recurring-1';
		apiClientMock.apiFetch.mockImplementation((url: string, options?: { method?: string }) => {
			if (url.endsWith('/expenses') && options?.method === 'POST') {
				return Promise.resolve({
					ok: true,
					data: {
						expense: {
							id: 'expense-1',
							description: 'Internet',
							amountCents: 3290,
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							splits: [],
							imageUrl: null,
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
						},
					},
				});
			}
			if (url.endsWith('/recurring-expenses') && options?.method === 'PATCH') {
				return Promise.resolve({
					ok: true,
					data: {
						recurringExpense: {
							id: 'recurring-1',
							description: 'Internet',
							amountCents: 3290,
							paidByMemberId: 'member-1',
							intervalMonths: 1,
							nextDueAt: '2026-06-20T00:00:00.000Z',
							lastCreatedAt: '2026-05-20T10:00:00.000Z',
							splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
						},
					},
				});
			}
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({
					ok: true,
					data: {
						recurringExpenses: [
							{
								id: 'recurring-1',
								description: 'Internet',
								amountCents: 3290,
								paidByMemberId: 'member-1',
								intervalMonths: 1,
								nextDueAt: '2026-05-20T00:00:00.000Z',
								lastCreatedAt: null,
								splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
							},
						],
					},
				});
			}
			return Promise.resolve({ ok: true, data: { expenses: [] } });
		});

		render(<AusgabenPage />);

		const saveButton = await screen.findByRole('button', { name: 'Ausgabe speichern' });
		fireEvent.click(saveButton);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/recurring-expenses', {
				method: 'PATCH',
				memberId: 'member-1',
				body: JSON.stringify({
					id: 'recurring-1',
					expectedNextDueAt: '2026-05-20T00:00:00.000Z',
				}),
			}),
		);
	});

	it('keeps expense edit actions visible and touch-sized on mobile', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			return Promise.resolve({
				ok: true,
				data: {
					expenses: [
						{
							id: 'expense-1',
							description: 'Internet',
							amountCents: 3290,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
							splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
						},
					],
				},
			});
		});

		render(<AusgabenPage />);

		const editButton = await screen.findByRole('button', { name: 'Ausgabe bearbeiten: Internet' });
		expect(editButton).not.toHaveClass('opacity-0');
		expect(editButton).toHaveClass('opacity-70');
		expect(editButton).toHaveClass('h-11');
		expect(editButton).toHaveClass('w-11');
	});

	it('RED BUG-360: clears the highlighted-expense scroll timer when unmounted', async () => {
		navigationMock.searchParams = 'highlight=expense-1';
		const originalSetTimeout = window.setTimeout.bind(window);
		const highlightedTimerId = 4242 as unknown as ReturnType<typeof window.setTimeout>;
		const setTimeoutSpy = vi
			.spyOn(window, 'setTimeout')
			.mockImplementation(
				(
					handler: TimerHandler,
					timeout?: number,
					...args: unknown[]
				): ReturnType<typeof window.setTimeout> => {
					if (timeout === 80) {
						return highlightedTimerId;
					}
					return originalSetTimeout(handler, timeout, ...args) as unknown as ReturnType<
						typeof window.setTimeout
					>;
				},
			);
		const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			return Promise.resolve({
				ok: true,
				data: {
					expenses: [
						{
							id: 'expense-1',
							description: 'Internet',
							amountCents: 3290,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
							splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
						},
					],
				},
			});
		});

		const { unmount } = render(<AusgabenPage />);

		await screen.findByRole('button', { name: 'Ausgabe bearbeiten: Internet' });
		await waitFor(() => expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 80));

		unmount();

		expect(clearTimeoutSpy).toHaveBeenCalledWith(highlightedTimerId);
	});

	it('RED BUG-361: does not reload expenses after offline sync resolves post-unmount', async () => {
		let resolveSync: (synced: number) => void = () => undefined;
		const syncDone = new Promise<number>((resolve) => {
			resolveSync = resolve;
		});
		offlineClientMock.syncOfflineActions.mockImplementationOnce(() => syncDone);
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			return Promise.resolve({
				ok: true,
				data: {
					expenses: [
						{
							id: 'expense-1',
							description: 'Internet',
							amountCents: 3290,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
							splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
						},
					],
				},
			});
		});

		const { unmount } = render(<AusgabenPage />);

		await screen.findByRole('button', { name: 'Ausgabe bearbeiten: Internet' });
		const callsBeforeUnmount = apiClientMock.apiFetch.mock.calls.length;

		unmount();
		await act(async () => {
			resolveSync(1);
			await syncDone;
		});

		expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(callsBeforeUnmount);
	});

	it('renders expense conflict recovery actions as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string, options?: { method?: string }) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({ ok: true, data: { recurringExpenses: [] } });
			}
			if (url.includes('/expenses/expense-1') && options?.method === 'PATCH') {
				return Promise.resolve({ ok: false, status: 409, error: 'expense_conflict' });
			}
			return Promise.resolve({
				ok: true,
				data: {
					expenses: [
						{
							id: 'expense-1',
							description: 'Internet',
							amountCents: 3290,
							currency: 'EUR',
							paidByMemberId: 'member-1',
							paidByName: 'Ava',
							imageUrl: null,
							occurredAt: '2026-05-20T10:00:00.000Z',
							createdAt: '2026-05-20T10:00:00.000Z',
							updatedAt: '2026-05-20T10:00:00.000Z',
							splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
						},
					],
				},
			});
		});

		render(<AusgabenPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Ausgabe bearbeiten: Internet' }));
		fireEvent.click(screen.getByRole('button', { name: 'Ausgabe speichern' }));

		expect(await screen.findByRole('button', { name: 'Server-Version laden' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Meinen Entwurf behalten' })).toHaveClass('h-11');
	});

	it('renders recurring expense actions as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({
					ok: true,
					data: {
						recurringExpenses: [
							{
								id: 'recurring-1',
								description: 'Internet',
								amountCents: 3290,
								paidByMemberId: 'member-1',
								intervalMonths: 1,
								nextDueAt: '2026-05-01T00:00:00.000Z',
								lastCreatedAt: null,
								splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
							},
						],
					},
				});
			}
			return Promise.resolve({ ok: true, data: { expenses: [] } });
		});

		render(<AusgabenPage />);

		expect(
			await screen.findByRole('button', { name: 'Fixkosten-Ausgabe direkt erstellen: Internet' }),
		).toHaveClass('h-11');
		expect(
			screen.getByRole('button', { name: 'Fixkosten-Vorlage bearbeiten: Internet' }),
		).toHaveClass('h-11');
		expect(
			screen.getByRole('link', { name: 'Fixkosten-Ausgabe manuell erfassen: Internet' }),
		).toHaveClass('h-11');
	});

	it('renders the recurring expense overflow link as a touch-sized control', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/recurring-expenses')) {
				return Promise.resolve({
					ok: true,
					data: {
						recurringExpenses: Array.from({ length: 5 }, (_, index) => ({
							id: `recurring-${index + 1}`,
							description: `Fixkosten ${index + 1}`,
							amountCents: 3290,
							paidByMemberId: 'member-1',
							intervalMonths: 1,
							nextDueAt: '2026-06-01T00:00:00.000Z',
							lastCreatedAt: null,
							splits: [{ debtorMemberId: 'member-1', amountCents: 3290 }],
						})),
					},
				});
			}
			return Promise.resolve({ ok: true, data: { expenses: [] } });
		});

		render(<AusgabenPage />);

		expect(await screen.findByRole('link', { name: 'Alle 5 Fixkosten anzeigen' })).toHaveClass(
			'h-11',
		);
	});
});

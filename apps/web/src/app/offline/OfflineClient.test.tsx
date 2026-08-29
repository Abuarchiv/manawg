import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineClient, formatOfflineAge } from './OfflineClient';

const identityMock = vi.hoisted(() => ({
	getKnownWgs: vi.fn(),
}));
const offlineClientMock = vi.hoisted(() => ({
	readOfflineQueue: vi.fn(),
	syncOfflineActions: vi.fn(),
}));

vi.mock('@/shared/lib/identity', () => ({
	getKnownWgs: () => identityMock.getKnownWgs(),
}));

vi.mock('@/core/offline/offline-client', () => ({
	readOfflineQueue: () => offlineClientMock.readOfflineQueue(),
	syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
}));

const queuedShoppingAction = {
	id: 'shopping:MTE8PZAT:test',
	type: 'shopping.create',
	shareCode: 'MTE8PZAT',
	memberId: 'member-1',
	createdAt: '2026-05-19T11:45:00.000Z',
	payload: { name: 'Milch', quantity: '1L' },
} as const;

describe('formatOfflineAge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
	});

	it('formats queued action age for the offline page', () => {
		const now = new Date('2026-05-19T12:00:00.000Z').getTime();

		expect(formatOfflineAge('2026-05-19T11:45:00.000Z', now)).toBe('vor 15 Min.');
		expect(formatOfflineAge('2026-05-19T09:00:00.000Z', now)).toBe('vor 3 Std.');
	});

	it('keeps invalid queued timestamps readable', () => {
		expect(formatOfflineAge('broken')).toBe('Zeitpunkt unklar');
	});

	it('keeps queued future timestamps readable', () => {
		const now = new Date('2026-05-19T12:00:00.000Z').getTime();

		expect(formatOfflineAge('2026-05-19T12:05:00.000Z', now)).toBe('Zeitpunkt in der Zukunft');
	});

	it('shows review hints for risky queued actions on the offline page', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'shopping-update:MTE8PZAT:test',
				type: 'shopping.update',
				shareCode: 'MTE8PZAT',
				memberId: 'member-1',
				createdAt: 'broken',
				payload: { itemId: 'item-1', name: 'Milch', bought: true },
			},
		]);

		render(<OfflineClient />);

		expect(screen.getByText('Zeitpunkt unklar')).toBeVisible();
		expect(screen.getByText(/Zeitpunkt prüfen:/)).toBeVisible();
		expect(screen.getByText(/Prüfe den Eintrag vor dem erneuten Senden/)).toBeVisible();
	});

	it('shows a specific review hint for stale queued absences', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'absence:MTE8PZAT:test',
				type: 'absence.create',
				shareCode: 'MTE8PZAT',
				memberId: 'member-1',
				createdAt: '2026-05-18T08:00:00.000Z',
				payload: {
					absenceMemberId: 'member-2',
					startDate: '2026-05-20T00:00:00.000Z',
					endDate: '2026-05-22T23:59:59.000Z',
					reason: 'Urlaub',
				},
			},
		]);

		render(<OfflineClient />);

		expect(screen.getByText('Abwesenheit', { selector: 'p' })).toBeVisible();
		expect(screen.getByText(/Abwesenheit prüfen:/)).toBeVisible();
		expect(
			screen.getByText(/Prüfe kurz, ob Zeitraum oder Putzplan inzwischen geändert wurden/),
		).toBeVisible();
	});

	it('shows a specific review hint for stale queued chore creations', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'chore:MTE8PZAT:test',
				type: 'chore.create',
				shareCode: 'MTE8PZAT',
				memberId: 'member-1',
				createdAt: '2026-05-18T08:00:00.000Z',
				payload: { title: 'Küche putzen', intervalDays: 7, assignedMemberId: null },
			},
		]);

		render(<OfflineClient />);

		expect(screen.getByText('Putzplan-Aufgabe')).toBeVisible();
		expect(screen.getByText(/Putzplan prüfen:/)).toBeVisible();
		expect(
			screen.getByText(
				/Prüfe kurz, ob Aufgabe, Intervall oder Zuweisung inzwischen geändert wurden/,
			),
		).toBeVisible();
	});

	it('shows a specific review hint for stale queued announcements', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([
			{
				id: 'announcement:MTE8PZAT:test',
				type: 'announcement.create',
				shareCode: 'MTE8PZAT',
				memberId: 'member-1',
				createdAt: '2026-05-18T08:00:00.000Z',
				payload: { content: 'Fenster bleibt heute offen', kind: 'info' },
			},
		]);

		render(<OfflineClient />);

		expect(screen.getByText('Pinnwand-Beitrag')).toBeVisible();
		expect(screen.getByText(/Pinnwand prüfen:/)).toBeVisible();
		expect(
			screen.getByText(/Prüfe kurz, ob Inhalt, Kategorie oder Status inzwischen überholt sind/),
		).toBeVisible();
	});

	it('updates and announces connection status changes', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([]);

		render(<OfflineClient />);

		const statusHeading = screen.getByRole('heading', { name: 'Du bist wieder verbunden.' });
		expect(statusHeading).toHaveAttribute('aria-live', 'polite');

		Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
		fireEvent(window, new Event('offline'));

		expect(screen.getByRole('heading', { name: 'Du bist gerade offline.' })).toHaveAttribute(
			'aria-live',
			'polite',
		);
	});

	it('shows when additional queued actions are hidden from the preview', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE/8PZAT?x=1', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue(
			Array.from({ length: 6 }, (_, index) => ({
				...queuedShoppingAction,
				shareCode: 'MTE/8PZAT?x=1',
				id: `shopping:MTE/8PZAT?x=1:${index}`,
				payload: { name: `Artikel ${index + 1}`, quantity: null },
			})),
		);

		render(<OfflineClient />);

		expect(screen.getByText('6 Aktionen warten.')).toBeVisible();
		expect(screen.getByText('6 Aktionen warten', { selector: 'span' })).toBeVisible();
		expect(screen.getByText('Artikel 1')).toBeVisible();
		expect(screen.getByText('Artikel 4')).toBeVisible();
		expect(screen.queryByText('Artikel 5')).not.toBeInTheDocument();
		expect(screen.getByText(/\+2 weitere Aktionen/)).toBeVisible();
		expect(screen.getByRole('link', { name: 'Alle Aktionen prüfen' })).toHaveAttribute(
			'href',
			'/wg/MTE%2F8PZAT%3Fx%3D1/einstellungen#daten',
		);
		expect(screen.getByText(/öffnet die vollständige Liste/)).toBeVisible();
	});

	it('syncs queued offline actions and refreshes the page state', async () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue
			.mockReturnValueOnce([queuedShoppingAction])
			.mockReturnValueOnce([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(1);

		render(<OfflineClient />);

		expect(screen.getByText('1 Aktion wartet.')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Offline-Status erneut prüfen' })).toBeVisible();
		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }));

		await waitFor(() => {
			expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledWith(undefined, { force: true });
		});
		expect(await screen.findByRole('status')).toHaveTextContent('1 Aktion synchronisiert.');
		expect(screen.getByText('Keine wartenden Aktionen.')).toBeVisible();
	});

	it('keeps manual sync feedback honest when actions remain queued', async () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue
			.mockReturnValueOnce([
				queuedShoppingAction,
				{
					...queuedShoppingAction,
					id: 'shopping:MTE8PZAT:second',
					payload: { name: 'Kaffee', quantity: null },
				},
			])
			.mockReturnValueOnce([
				{
					...queuedShoppingAction,
					id: 'shopping:MTE8PZAT:second',
					payload: { name: 'Kaffee', quantity: null },
				},
			]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(1);

		render(<OfflineClient />);

		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }));

		expect(await screen.findByRole('status')).toHaveTextContent(
			'1 Aktion synchronisiert. 1 Aktion wartet weiter.',
		);
		expect(screen.getByText('1 Aktion wartet.')).toBeVisible();
	});

	it('clears stale manual sync feedback when the queue changes again', async () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue
			.mockReturnValueOnce([
				queuedShoppingAction,
				{
					...queuedShoppingAction,
					id: 'shopping:MTE8PZAT:second',
					payload: { name: 'Kaffee', quantity: null },
				},
			])
			.mockReturnValueOnce([
				{
					...queuedShoppingAction,
					id: 'shopping:MTE8PZAT:second',
					payload: { name: 'Kaffee', quantity: null },
				},
			])
			.mockReturnValueOnce([
				{
					...queuedShoppingAction,
					id: 'shopping:MTE8PZAT:second',
					payload: { name: 'Kaffee', quantity: null },
				},
				{
					...queuedShoppingAction,
					id: 'shopping:MTE8PZAT:third',
					payload: { name: 'Tee', quantity: null },
				},
			]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(1);

		render(<OfflineClient />);

		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }));

		expect(await screen.findByRole('status')).toHaveTextContent(
			'1 Aktion synchronisiert. 1 Aktion wartet weiter.',
		);

		fireEvent(window, new CustomEvent('manawg:offline-queue'));

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.getByText('2 Aktionen warten.')).toBeVisible();
	});

	it('does not claim actions remain stored when manual sync finds an empty queue', async () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue
			.mockReturnValueOnce([queuedShoppingAction])
			.mockReturnValueOnce([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(0);

		render(<OfflineClient />);

		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }));

		expect(await screen.findByRole('status')).toHaveTextContent('Keine wartenden Aktionen mehr.');
		expect(screen.queryByText('Noch nichts synchronisiert.')).not.toBeInTheDocument();
		expect(screen.getByText('Keine wartenden Aktionen.')).toBeVisible();
	});

	it('keeps queued actions visible when manual sync fails', async () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([queuedShoppingAction]);
		offlineClientMock.syncOfflineActions.mockRejectedValue(new Error('network down'));

		render(<OfflineClient />);

		fireEvent.click(screen.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }));

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.',
		);
		expect(screen.getByText('1 Aktion wartet.')).toBeVisible();
		expect(
			screen.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }),
		).toBeEnabled();
	});

	it('does not start duplicate page syncs from repeated clicks', () => {
		identityMock.getKnownWgs.mockReturnValue([
			{ code: 'MTE8PZAT', name: 'Test WG', lastVisitedAt: Date.now() },
		]);
		offlineClientMock.readOfflineQueue.mockReturnValue([queuedShoppingAction]);
		offlineClientMock.syncOfflineActions.mockReturnValue(new Promise(() => {}));

		render(<OfflineClient />);

		const syncButton = screen.getByRole('button', {
			name: 'Offline-Aktionen jetzt synchronisieren',
		});
		fireEvent.click(syncButton);
		fireEvent.click(syncButton);

		expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledTimes(1);
		expect(
			screen.getByRole('button', { name: 'Offline-Aktionen werden synchronisiert' }),
		).toBeDisabled();
	});
});

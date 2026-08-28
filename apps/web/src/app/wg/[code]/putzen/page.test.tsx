import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PutzenPage from './page';

const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
const offlineClientMock = vi.hoisted(() => ({
	countOfflineActions: vi.fn(),
	readOfflineQueue: vi.fn(),
	syncOfflineActions: vi.fn(),
	writeOfflineQueue: vi.fn(),
}));

vi.mock('next/navigation', () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: {
			id: 'wg-1',
			name: 'Test WG',
			shareCode: 'WG/123?x=1',
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

const chores = Array.from({ length: 5 }, (_, index) => ({
	id: `chore-${index + 1}`,
	title: `Aufgabe ${index + 1}`,
	intervalDays: 7,
	nextDueAt: '2026-01-01T00:00:00.000Z',
	assignedMemberId: index % 2 === 0 ? 'member-1' : 'member-2',
	lastCompletedAt: null,
	lastCompletedByName: null,
	openGapCountForAssignee: 0,
}));

const absences = Array.from({ length: 5 }, (_, index) => ({
	id: `absence-${index + 1}`,
	memberId: index % 2 === 0 ? 'member-1' : 'member-2',
	memberName: index % 2 === 0 ? 'Ava' : 'Ben',
	startDate: '2026-06-01T00:00:00.000Z',
	endDate: '2026-06-02T23:59:59.000Z',
	reason: null,
}));

describe('PutzenPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/chores')) {
				return Promise.resolve({ ok: true, data: { chores } });
			}
			if (url.endsWith('/absences')) {
				return Promise.resolve({ ok: true, data: { absences } });
			}
			return Promise.resolve({ ok: true, data: {} });
		});
		offlineClientMock.countOfflineActions.mockReturnValue(0);
		offlineClientMock.readOfflineQueue.mockReturnValue([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(0);
		offlineClientMock.writeOfflineQueue.mockReturnValue(true);
	});

	it('encodes the WG code in chore API calls and visible links', async () => {
		render(<PutzenPage />);

		await waitFor(() => {
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/chores', {
				memberId: 'member-1',
			});
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/absences', {
				memberId: 'member-1',
			});
		});
		expect(screen.getByRole('link', { name: 'Verlauf' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/aktivitaet',
		);
		expect(screen.getByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/einstellungen',
		);
		expect(screen.getByRole('link', { name: 'Alle 5 Abwesenheiten anzeigen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/putzen?panel=absences',
		);
		expect(screen.getByRole('link', { name: 'Alle 5 Putzlücken anzeigen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/putzen?filter=overdue',
		);
	});

	it('renders the load retry action as a touch-sized control', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/chores')) {
				return Promise.resolve({ ok: false, status: 500, error: 'unexpected_error' });
			}
			if (url.endsWith('/absences')) {
				return Promise.resolve({ ok: true, data: { absences: [] } });
			}
			return Promise.resolve({ ok: true, data: {} });
		});

		render(<PutzenPage />);

		expect(await screen.findByRole('button', { name: 'Putzplan erneut laden' })).toHaveClass(
			'h-11',
		);
	});

	it('renders empty-state chore templates as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/chores')) {
				return Promise.resolve({ ok: true, data: { chores: [] } });
			}
			if (url.endsWith('/absences')) {
				return Promise.resolve({ ok: true, data: { absences: [] } });
			}
			return Promise.resolve({ ok: true, data: {} });
		});

		render(<PutzenPage />);

		expect(await screen.findByRole('button', { name: 'Bad putzen' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Küche wischen' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Müll rausbringen' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Flur saugen' })).toHaveClass('min-h-11');
	});

	it('renders absence removal actions as touch-sized controls', async () => {
		render(<PutzenPage />);

		const removeButtons = await screen.findAllByRole('button', { name: /entfernen/i });
		expect(removeButtons[0]).toHaveClass('h-11');
	});

	it('renders the absence save action as a touch-sized control', async () => {
		render(<PutzenPage />);

		expect(await screen.findByRole('button', { name: 'Abwesenheit speichern' })).toHaveClass(
			'h-11',
		);
	});

	it('renders absence form inputs as touch-sized controls', async () => {
		render(<PutzenPage />);

		expect(await screen.findByLabelText('Abwesendes Mitglied')).toHaveClass('h-11');
		expect(screen.getByLabelText('Abwesenheit von')).toHaveClass('h-11');
		expect(screen.getByLabelText('Abwesenheit bis')).toHaveClass('h-11');
		expect(screen.getByPlaceholderText('Grund optional')).toHaveClass('h-11');
	});

	it('renders overflow links as touch-sized controls', async () => {
		render(<PutzenPage />);

		expect(await screen.findByRole('link', { name: 'Alle 5 Abwesenheiten anzeigen' })).toHaveClass(
			'h-11',
		);
		expect(screen.getByRole('link', { name: 'Alle 5 Putzlücken anzeigen' })).toHaveClass('h-11');
	});

	it('renders repair actions as touch-sized controls', async () => {
		render(<PutzenPage />);

		const suggestedAssignButtons = await screen.findAllByRole('button', {
			name: /Aufgabe .* zuweisen: Aufgabe/,
		});
		expect(suggestedAssignButtons[0]).toHaveClass('h-11');
		expect(
			screen.getByRole('button', { name: 'Aufgabe selbst übernehmen: Aufgabe 2' }),
		).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Aufgabe erledigen: Aufgabe 2' })).toHaveClass(
			'h-11',
		);
	});

	it('explains when a completed chore was rotated but the completion log could not be saved', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.endsWith('/chores')) {
				return Promise.resolve({ ok: true, data: { chores: [chores[0]] } });
			}
			if (url.endsWith('/absences')) {
				return Promise.resolve({ ok: true, data: { absences: [] } });
			}
			if (url.endsWith('/complete')) {
				return Promise.resolve({
					ok: false,
					status: 500,
					error: 'completion_insert_failed',
				});
			}
			return Promise.resolve({ ok: true, data: {} });
		});

		render(<PutzenPage />);

		fireEvent.click(
			await screen.findByRole('button', { name: 'Überfällige Aufgabe nachholen: Aufgabe 1' }),
		);
		fireEvent.click(screen.getByRole('button', { name: 'Nachholen bestätigen: Aufgabe 1' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Erledigt-Aktion konnte nicht vollständig gespeichert werden: Lade den Plan neu und prüfe den Verlauf.',
		);
		expect(
			screen.queryByText(
				'Erledigt-Aktion konnte nicht gespeichert werden: Versuche es gleich erneut.',
			),
		).not.toBeInTheDocument();
	});

	it('explains server errors while posting a chore swap request', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string, options?: { method?: string }) => {
			if (url.endsWith('/chores')) {
				return Promise.resolve({ ok: true, data: { chores: [chores[0]] } });
			}
			if (url.endsWith('/absences')) {
				return Promise.resolve({ ok: true, data: { absences: [] } });
			}
			if (url.endsWith('/announcements') && options?.method === 'POST') {
				return Promise.resolve({ ok: false, status: 500, error: 'server_error' });
			}
			return Promise.resolve({ ok: true, data: {} });
		});

		render(<PutzenPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Tausch anfragen: Aufgabe 1' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Tauschanfrage konnte nicht gepostet werden: Versuche es gleich erneut.',
		);
		expect(
			screen.queryByText('Tauschanfrage konnte nicht gepostet werden.'),
		).not.toBeInTheDocument();
	});

	it('explains server errors while taking over a chore', async () => {
		apiClientMock.apiFetch.mockImplementation((url: string, options?: { method?: string }) => {
			if (url.endsWith('/chores')) {
				return Promise.resolve({ ok: true, data: { chores: [chores[1]] } });
			}
			if (url.endsWith('/absences')) {
				return Promise.resolve({ ok: true, data: { absences: [] } });
			}
			if (url.includes('/chores/chore-2') && options?.method === 'PATCH') {
				return Promise.resolve({ ok: false, status: 500, error: 'server_error' });
			}
			return Promise.resolve({ ok: true, data: {} });
		});

		render(<PutzenPage />);

		fireEvent.click(
			await screen.findByRole('button', { name: 'Aufgabe selbst übernehmen: Aufgabe 2' }),
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Aufgabe konnte nicht übernommen werden: Versuche es gleich erneut.',
		);
		expect(screen.queryByText('Aufgabe konnte nicht übernommen werden.')).not.toBeInTheDocument();
	});
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PinnwandPage from './page';

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
		members: [{ id: 'member-1', name: 'Ava', color: null }],
		identity: { memberId: 'member-1', name: 'Ava' },
	}),
}));

vi.mock('@/lib/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

vi.mock('@/lib/wg/offline-client', () => ({
	countOfflineActions: (...args: unknown[]) => offlineClientMock.countOfflineActions(...args),
	enqueueOfflineAction: vi.fn(),
	readOfflineQueue: (...args: unknown[]) => offlineClientMock.readOfflineQueue(...args),
	syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
	writeOfflineQueue: (...args: unknown[]) => offlineClientMock.writeOfflineQueue(...args),
}));

describe('PinnwandPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				announcements: [
					{
						id: 'announcement-1',
						authorMemberId: 'member-1',
						content: 'Milch kaufen',
						imageUrl: null,
						kind: 'request',
						status: 'open',
						source: 'shopping',
						sourcePath: '/einkauf?highlight=shopping-1',
						pinnedAt: null,
						resolvedAt: null,
						resolvedByMemberId: null,
						createdAt: '2026-05-18T12:00:00.000Z',
						reactionCounts: {},
						myReactions: [],
						takers: [],
						comments: [],
					},
				],
			},
		});
		offlineClientMock.countOfflineActions.mockReturnValue(0);
		offlineClientMock.readOfflineQueue.mockReturnValue([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(0);
		offlineClientMock.writeOfflineQueue.mockReturnValue(true);
	});

	it('encodes the WG code in announcement API calls and visible links', async () => {
		render(<PinnwandPage />);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/WG%2F123%3Fx%3D1/announcements',
				{ memberId: 'member-1' },
			),
		);
		expect(screen.getByRole('link', { name: 'Verlauf' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/aktivitaet',
		);
		expect(screen.getByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/einstellungen',
		);
		expect(
			await screen.findByRole('link', { name: 'Quelle öffnen: Milch kaufen' }),
		).toHaveAttribute('href', '/wg/WG%2F123%3Fx%3D1/einkauf?highlight=shopping-1');
	});

	it('renders the load retry action as a touch-sized control', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: false,
			status: 500,
			error: 'db_error',
		});

		render(<PinnwandPage />);

		expect(await screen.findByRole('button', { name: 'Pinnwand erneut laden' })).toHaveClass(
			'h-11',
		);
	});

	it('renders filter actions as touch-sized controls', async () => {
		render(<PinnwandPage />);

		expect(await screen.findByRole('button', { name: 'Alle' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Offen' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Geklärt' })).toHaveClass('h-11');
		expect(screen.getByRole('combobox', { name: 'Typ filtern' })).toHaveClass('h-11');
		expect(screen.getByRole('combobox', { name: 'Verantwortlichkeit filtern' })).toHaveClass(
			'h-11',
		);
		expect(screen.getByRole('button', { name: 'Fixiert' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Kompakte Ansicht' })).toHaveClass('h-11', 'w-11');
		expect(screen.getByRole('button', { name: 'Pinnwand aktualisieren' })).toHaveClass('h-11');
	});

	it('renders empty pinnwand quick-start actions as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: { announcements: [] },
		});

		render(<PinnwandPage />);

		expect(await screen.findByRole('button', { name: 'Paket im Flur' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Küche kurz klären' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Besuch heute Abend' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Wer kann helfen?' })).toHaveClass('h-11');
	});

	it('renders announcement composer type actions as touch-sized controls', async () => {
		render(<PinnwandPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Beitrag erstellen' }));

		expect(screen.getByRole('button', { name: 'Info' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Frage' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Bitte' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Entscheidung' })).toHaveClass('h-11');
	});

	it('renders my open announcement shortcuts as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				announcements: [
					{
						id: 'announcement-1',
						authorMemberId: 'member-1',
						content: 'Milch kaufen',
						imageUrl: null,
						kind: 'request',
						status: 'open',
						source: 'shopping',
						sourcePath: '/einkauf?highlight=shopping-1',
						pinnedAt: null,
						resolvedAt: null,
						resolvedByMemberId: null,
						createdAt: '2026-05-18T12:00:00.000Z',
						reactionCounts: { take: 1 },
						myReactions: ['take'],
						takers: [{ memberId: 'member-1', name: 'Ava' }],
						comments: [],
					},
				],
			},
		});

		render(<PinnwandPage />);

		const section = (await screen.findByText('Meine offenen Sachen')).closest('section');
		if (!section) throw new Error('my open section missing');

		expect(within(section).getByRole('button', { name: /Milch kaufen/ })).toHaveClass('min-h-11');
	});

	it('renders announcement card actions as touch-sized controls', async () => {
		render(<PinnwandPage />);

		expect(
			await screen.findByRole('button', { name: 'Beitrag fixieren: Milch kaufen' }),
		).toHaveClass('h-11', 'w-11');
		expect(screen.getByRole('button', { name: 'Als geklärt markieren: Milch kaufen' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(screen.getByRole('button', { name: 'Beitragsaktionen: Milch kaufen' })).toHaveClass(
			'h-11',
			'w-11',
		);
	});

	it('renders mobile announcement menu actions as touch-sized controls', async () => {
		render(<PinnwandPage />);

		fireEvent.click(await screen.findByRole('button', { name: 'Beitragsaktionen: Milch kaufen' }));

		const pinActions = screen.getAllByRole('button', { name: 'Beitrag fixieren: Milch kaufen' });
		const statusActions = screen.getAllByRole('button', {
			name: 'Als geklärt markieren: Milch kaufen',
		});
		const removeActions = screen.getAllByRole('button', {
			name: 'Beitrag entfernen: Milch kaufen',
		});

		expect(pinActions.at(-1)).toHaveClass('h-11');
		expect(statusActions.at(-1)).toHaveClass('h-11');
		expect(removeActions.at(-1)).toHaveClass('h-11');
	});

	it('renders announcement footer actions as touch-sized controls', async () => {
		render(<PinnwandPage />);

		expect(await screen.findByRole('link', { name: 'Quelle öffnen: Milch kaufen' })).toHaveClass(
			'h-11',
		);
		expect(
			screen.getByRole('link', { name: 'Als Einkaufsartikel übernehmen: Milch kaufen' }),
		).toHaveClass('h-11');
		expect(
			screen.getByRole('link', { name: 'Als Putzaufgabe übernehmen: Milch kaufen' }),
		).toHaveClass('h-11');
		expect(screen.getByRole('link', { name: 'Als Ausgabe übernehmen: Milch kaufen' })).toHaveClass(
			'h-11',
		);
		expect(
			screen.getByRole('button', { name: 'Gesehen-Reaktion setzen: Milch kaufen' }),
		).toHaveClass('h-11');
		expect(
			screen.getByRole('button', { name: 'Übernehme ich-Reaktion setzen: Milch kaufen' }),
		).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Antworten anzeigen: Milch kaufen' })).toHaveClass(
			'h-11',
		);
	});

	it('renders editable comment actions as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				announcements: [
					{
						id: 'announcement-1',
						authorMemberId: 'member-1',
						content: 'Milch kaufen',
						imageUrl: null,
						kind: 'request',
						status: 'open',
						source: 'shopping',
						sourcePath: '/einkauf?highlight=shopping-1',
						pinnedAt: null,
						resolvedAt: null,
						resolvedByMemberId: null,
						createdAt: '2026-05-18T12:00:00.000Z',
						reactionCounts: {},
						myReactions: [],
						takers: [],
						comments: [
							{
								id: 'comment-1',
								announcementId: 'announcement-1',
								memberId: 'member-1',
								authorName: 'Ava',
								authorColor: null,
								content: 'Bin dran',
								createdAt: '2026-05-18T12:05:00.000Z',
								updatedAt: '2026-05-18T12:05:00.000Z',
							},
						],
					},
				],
			},
		});

		render(<PinnwandPage />);

		const editButton = await screen.findByRole('button', {
			name: 'Kommentar bearbeiten: Bin dran',
		});
		const removeButton = screen.getByRole('button', {
			name: 'Kommentar entfernen: Bin dran',
		});

		expect(editButton).toHaveClass('h-11', 'w-11');
		expect(removeButton).toHaveClass('h-11', 'w-11');
	});

	it('renders comment submit actions as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				announcements: [
					{
						id: 'announcement-1',
						authorMemberId: 'member-1',
						content: 'Milch kaufen',
						imageUrl: null,
						kind: 'request',
						status: 'open',
						source: 'shopping',
						sourcePath: '/einkauf?highlight=shopping-1',
						pinnedAt: null,
						resolvedAt: null,
						resolvedByMemberId: null,
						createdAt: '2026-05-18T12:00:00.000Z',
						reactionCounts: {},
						myReactions: [],
						takers: [],
						comments: [
							{
								id: 'comment-1',
								announcementId: 'announcement-1',
								memberId: 'member-1',
								authorName: 'Ava',
								authorColor: null,
								content: 'Bin dran',
								createdAt: '2026-05-18T12:05:00.000Z',
								updatedAt: '2026-05-18T12:05:00.000Z',
							},
						],
					},
				],
			},
		});

		render(<PinnwandPage />);

		expect(await screen.findByPlaceholderText('Antwort schreiben')).toHaveClass('min-h-11');
		expect(await screen.findByRole('button', { name: 'Antwort senden: Milch kaufen' })).toHaveClass(
			'h-11',
			'w-11',
		);

		fireEvent.click(screen.getByRole('button', { name: 'Kommentar bearbeiten: Bin dran' }));

		expect(screen.getByDisplayValue('Bin dran')).toHaveClass('min-h-16');
		expect(screen.getByRole('button', { name: 'Kommentar speichern: Bin dran' })).toHaveClass(
			'h-11',
		);
	});

	it('keeps an optimistic reaction removal when the server reports the reaction is already gone', async () => {
		apiClientMock.apiFetch
			.mockResolvedValueOnce({
				ok: true,
				data: {
					announcements: [
						{
							id: 'announcement-1',
							authorMemberId: 'member-1',
							content: 'Milch kaufen',
							imageUrl: null,
							kind: 'request',
							status: 'open',
							source: 'shopping',
							sourcePath: '/einkauf?highlight=shopping-1',
							pinnedAt: null,
							resolvedAt: null,
							resolvedByMemberId: null,
							createdAt: '2026-05-18T12:00:00.000Z',
							reactionCounts: { seen: 1 },
							myReactions: ['seen'],
							takers: [],
							comments: [],
						},
					],
				},
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 404,
				error: 'reaction_not_found',
			});

		render(<PinnwandPage />);

		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Gesehen-Reaktion entfernen: Milch kaufen',
			}),
		);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				'/api/wg/WG%2F123%3Fx%3D1/announcements/announcement-1/reactions',
				{
					method: 'POST',
					memberId: 'member-1',
					body: JSON.stringify({ reaction: 'seen' }),
				},
			),
		);
		expect(
			await screen.findByText('Diese Reaktion war schon entfernt. Die Pinnwand bleibt aktuell.'),
		).toBeInTheDocument();

		const seenButton = screen.getByRole('button', {
			name: 'Gesehen-Reaktion setzen: Milch kaufen',
		});
		expect(seenButton).toHaveAttribute('aria-pressed', 'false');
		expect(seenButton).toHaveTextContent('Gesehen');
		expect(seenButton).not.toHaveTextContent('1');
	});
});

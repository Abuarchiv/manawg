import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KalenderPage from './page';

const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: {
			id: 'wg-1',
			name: 'Test WG',
			shareCode: 'MTE8PZAT',
			joiningEnabled: true,
		},
		members: [{ id: 'member-1', name: 'Ava', color: null }],
		identity: { memberId: 'member-1', name: 'Ava' },
	}),
}));

vi.mock('@/lib/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

const upcomingEvent = {
	id: 'evt-1',
	title: 'Heizungsablesung',
	description: null,
	startsAt: new Date(Date.now() + 86_400_000).toISOString(),
	endsAt: null,
	allDay: false,
	location: null,
	recurrence: null,
};

describe('KalenderPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Element.prototype.scrollIntoView = vi.fn();
		apiClientMock.apiFetch.mockImplementation((url: string) => {
			if (url.includes('/events')) {
				return Promise.resolve({ ok: true, data: { events: [upcomingEvent] } });
			}
			if (url.includes('/chores')) {
				return Promise.resolve({ ok: true, data: { chores: [] } });
			}
			return Promise.resolve({ ok: true, data: {} });
		});
	});

	it('renders the calendar heading', async () => {
		render(<KalenderPage />);
		expect(await screen.findByRole('heading', { name: 'Kalender' })).toBeInTheDocument();
	});

	it('fetches events with from/to query params and renders upcoming entries', async () => {
		render(<KalenderPage />);
		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith(
				expect.stringMatching(/\/api\/wg\/MTE8PZAT\/events\?from=.*&to=.*/),
				expect.objectContaining({ memberId: 'member-1' }),
			),
		);
		// `findAllByText` accepts multiple matches (e.g. when EventCreateModal
		// is rendered open by a sibling test sharing the same vitest worker).
		const hits = await screen.findAllByText('Heizungsablesung');
		expect(hits.length).toBeGreaterThanOrEqual(1);
	});

	it('renders the "Neu" button to open the create modal', async () => {
		render(<KalenderPage />);
		const btn = await screen.findByRole('button', { name: 'Neuen Termin anlegen' });
		expect(btn).toBeInTheDocument();
	});
});

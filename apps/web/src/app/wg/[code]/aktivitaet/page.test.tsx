import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AktivitaetPage from './page';

const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => ({
		wg: {
			id: 'wg-1',
			name: 'Test WG',
			shareCode: 'WG/123?x=1',
			joiningEnabled: true,
		},
		identity: { memberId: 'member-1', name: 'Ava' },
	}),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

describe('AktivitaetPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [
					{
						kind: 'expense',
						timestamp: '2026-05-18T12:00:00.000Z',
						memberName: 'Ava',
						text: 'Internet',
						href: '/ausgaben?highlight=expense-1',
					},
				],
				reminders: [],
			},
		});
	});

	it('encodes the WG code in API calls and rendered activity links', async () => {
		render(<AktivitaetPage />);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/activity', {
				memberId: 'member-1',
			}),
		);
		expect(screen.getByRole('link', { name: 'Zurück zum Dashboard' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1',
		);
		expect(await screen.findByRole('link', { name: /Ava Internet/ })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/ausgaben?highlight=expense-1',
		);
	});

	it('renders header navigation actions as touch-sized controls', async () => {
		render(<AktivitaetPage />);

		expect(screen.getByRole('link', { name: 'Zurück zum Dashboard' })).toHaveClass('h-11', 'w-11');
		expect(screen.getByRole('button', { name: 'Aktivität aktualisieren' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(await screen.findByRole('link', { name: /Ava Internet/ })).toBeInTheDocument();
	});

	it('renders empty-state navigation actions as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: { items: [], reminders: [] },
		});

		render(<AktivitaetPage />);

		expect(await screen.findByRole('link', { name: 'Ausgabe eintragen' })).toHaveClass('h-11');
		expect(screen.getByRole('link', { name: 'Pinnwand starten' })).toHaveClass('h-11');
		expect(screen.getByRole('link', { name: 'Putzplan anlegen' })).toHaveClass('h-11');
	});

	it('renders the load retry action as a touch-sized control', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: false,
			status: 500,
			error: 'unexpected_error',
		});

		render(<AktivitaetPage />);

		const retry = await screen.findByRole('button', { name: 'Aktivität erneut laden' });
		expect(retry).toHaveClass('h-11');

		apiClientMock.apiFetch.mockResolvedValueOnce({
			ok: true,
			data: { items: [], reminders: [] },
		});
		fireEvent.click(retry);

		await waitFor(() => expect(apiClientMock.apiFetch).toHaveBeenCalledTimes(2));
	});

	it('renders filter actions and reset as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [
					{
						kind: 'expense',
						timestamp: '2026-05-18T12:00:00.000Z',
						memberName: 'Ava',
						text: 'Internet',
						href: '/ausgaben?highlight=expense-1',
					},
				],
				reminders: [],
			},
		});

		render(<AktivitaetPage />);

		expect(await screen.findByRole('button', { name: 'Aktivitätsumfang: Alle' })).toHaveClass(
			'h-11',
		);
		expect(screen.getByRole('button', { name: 'Ausgaben' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Nur ich' })).toHaveClass('h-11');

		fireEvent.click(screen.getByRole('button', { name: 'Putzen' }));

		expect(await screen.findByRole('button', { name: 'Filter zurücksetzen' })).toHaveClass('h-11');
	});

	it('filters activity by search query and clears the query when filters reset', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [
					{
						id: 'expense-1',
						kind: 'expense',
						timestamp: '2026-05-18T12:00:00.000Z',
						memberName: 'Ava',
						text: 'Internet',
						href: '/ausgaben?highlight=expense-1',
					},
				],
				reminders: [],
			},
		});

		render(<AktivitaetPage />);

		expect(await screen.findByRole('link', { name: /Ava Internet/ })).toBeInTheDocument();

		const searchInput = screen.getByPlaceholderText('Aktivität durchsuchen');
		fireEvent.change(searchInput, { target: { value: 'Müll' } });

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Keine sichtbaren Chronik-Einträge.',
		);
		expect(await screen.findByText('Keine Aktivität für diesen Filter.')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));

		expect(searchInput).toHaveValue('');
		expect(await screen.findByRole('link', { name: /Ava Internet/ })).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('1 Chronik-Eintrag sichtbar.');
	});

	it('renders inbox reminder links as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [],
				reminders: [
					{
						id: 'announcement-1',
						kind: 'announcement',
						priority: 'high',
						title: 'Badplan klären',
						detail: 'Pinnwand offen',
						href: '/pinnwand#announcement-1',
					},
				],
			},
		});

		render(<AktivitaetPage />);

		expect(await screen.findByRole('link', { name: /Badplan klären/ })).toHaveClass('min-h-11');
	});
});

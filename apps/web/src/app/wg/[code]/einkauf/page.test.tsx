import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EinkaufPage from './page';

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

describe('EinkaufPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [
					{
						id: 'shopping-1',
						addedByMemberId: 'member-1',
						name: 'Milch & Brot',
						quantity: '2x',
						boughtAt: '2026-05-18T12:00:00.000Z',
						boughtByMemberId: 'member-1',
						createdAt: '2026-05-18T10:00:00.000Z',
					},
				],
			},
		});
		offlineClientMock.countOfflineActions.mockReturnValue(0);
		offlineClientMock.readOfflineQueue.mockReturnValue([]);
		offlineClientMock.syncOfflineActions.mockResolvedValue(0);
		offlineClientMock.writeOfflineQueue.mockReturnValue(true);
	});

	it('encodes the WG code in shopping API calls and expense handoff links', async () => {
		render(<EinkaufPage />);

		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/shopping', {
				memberId: 'member-1',
			}),
		);
		expect(
			await screen.findByRole('link', { name: 'Milch & Brot als Ausgabe übernehmen' }),
		).toHaveAttribute('href', '/wg/WG%2F123%3Fx%3D1/ausgaben?desc=Milch%20%26%20Brot');
		expect(screen.getByRole('link', { name: 'Milch & Brot als Ausgabe übernehmen' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(screen.getByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/einstellungen',
		);
	});

	it('renders header actions as touch-sized controls', async () => {
		render(<EinkaufPage />);

		expect(screen.getByRole('button', { name: 'Einkaufsliste aktualisieren' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(screen.getByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveClass(
			'h-11',
			'w-11',
		);
		expect(
			await screen.findByRole('link', { name: 'Milch & Brot als Ausgabe übernehmen' }),
		).toBeInTheDocument();
	});

	it('renders the load retry action as a touch-sized control', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: false,
			status: 500,
			error: 'unexpected_error',
		});

		render(<EinkaufPage />);

		expect(await screen.findByRole('button', { name: 'Liste erneut laden' })).toHaveClass('h-11');
	});

	it('renders empty-state shopping templates as touch-sized controls', async () => {
		apiClientMock.apiFetch.mockResolvedValue({ ok: true, data: { items: [] } });

		render(<EinkaufPage />);

		expect(await screen.findByRole('button', { name: 'Milch' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Brot' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Kaffee' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Toilettenpapier' })).toHaveClass('h-11');
	});
});

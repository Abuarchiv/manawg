import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VorraetePage from './page';

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

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

describe('VorraetePage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [
					{
						id: 'inv-1',
						wgId: 'wg-1',
						name: 'Klopapier',
						quantity: 1,
						unit: 'Rolle',
						threshold: 4,
						category: 'bad',
						lastDecrementedAt: '2026-05-22T08:00:00.000Z',
						decrementCount30d: 3,
						createdAt: '2026-05-01T08:00:00.000Z',
						updatedAt: '2026-05-22T08:00:00.000Z',
					},
				],
				grouped: {
					bad: [],
					kueche: [],
					putzmittel: [],
					sonstiges: [],
				},
			},
		});
	});

	it('fetches inventory for the current WG and renders the header', async () => {
		render(<VorraetePage />);
		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/MTE8PZAT/inventory', {
				memberId: 'member-1',
			}),
		);
		expect(screen.getByRole('heading', { name: 'Vorräte' })).toBeInTheDocument();
		expect(
			await screen.findByRole('button', { name: 'Klopapier um eins verringern' }),
		).toBeInTheDocument();
	});

	it('shows the empty-state CTA when no items exist', async () => {
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				items: [],
				grouped: { bad: [], kueche: [], putzmittel: [], sonstiges: [] },
			},
		});
		render(<VorraetePage />);
		expect(
			await screen.findByRole('button', { name: 'Ersten Vorrat anlegen' }),
		).toBeInTheDocument();
	});
});

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MahnungenPage from './page';

const apiClientMock = vi.hoisted(() => ({ apiFetch: vi.fn() }));

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
			{ id: 'member-1', name: 'Alice', color: null },
			{ id: 'member-2', name: 'Ben', color: null },
		],
		identity: { memberId: 'member-1', name: 'Alice' },
	}),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

describe('MahnungenPage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiClientMock.apiFetch.mockImplementation(async (url: string) => {
			if (url.includes('/expenses')) {
				return {
					ok: true,
					data: {
						expenses: [
							{
								id: 'e-1',
								paidByMemberId: 'member-1',
								occurredAt: '2026-05-10T10:00:00.000Z',
								splits: [
									{
										id: 's-1',
										debtorMemberId: 'member-2',
										amountCents: 2340,
										settledAt: null,
									},
								],
							},
						],
					},
				};
			}
			return { ok: true, data: { reminders: [] } };
		});
	});

	it('loads expenses + reminders for the current member', async () => {
		render(<MahnungenPage />);
		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/expenses', {
				memberId: 'member-1',
			}),
		);
		expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/reminders', {
			memberId: 'member-1',
		});
	});

	it('renders an open-debt row with a Mahnen button when Ben owes Alice', async () => {
		render(<MahnungenPage />);
		const button = await screen.findByRole('button', { name: /mahnung senden — mahnen/i });
		expect(button).toBeInTheDocument();
		expect(screen.getByText('Ben')).toBeInTheDocument();
		expect(screen.getByText('Alice')).toBeInTheDocument();
	});

	it('shows the empty state when nothing is open', async () => {
		apiClientMock.apiFetch.mockImplementation(async (url: string) => {
			if (url.includes('/expenses')) return { ok: true, data: { expenses: [] } };
			return { ok: true, data: { reminders: [] } };
		});
		render(<MahnungenPage />);
		expect(await screen.findByText(/alles ausgeglichen/i)).toBeInTheDocument();
	});

	it('renders the load retry as a touch-sized control on error', async () => {
		apiClientMock.apiFetch.mockResolvedValue({ ok: false, status: 500, error: 'db_error' });
		render(<MahnungenPage />);
		expect(await screen.findByRole('button', { name: 'Erneut laden' })).toHaveClass('h-11');
	});
});

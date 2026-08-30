import type { DashboardData } from '@/core/reads/dashboard-data';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WgHomePage from './page';

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

function createDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
	return {
		balances: [
			{
				memberId: 'member-1',
				memberName: 'Ava',
				color: null,
				paidCents: 0,
				owedCents: 0,
				balanceCents: 0,
			},
		],
		spendByDay: [],
		totalSpendCents: 0,
		weekSpendCents: 0,
		monthSpendCents: 0,
		openShoppingCount: 0,
		openShoppingTop: [],
		dueChores: [],
		activity: [],
		latestAnnouncement: null,
		myOpenAnnouncements: [],
		wgHealth: { score: 100, label: 'Alles ruhig', items: [] },
		dueRecurringExpenses: [],
		absentMembers: [],
		setup: {
			choreCount: 0,
			hasExpense: false,
			hasShoppingItem: false,
			hasAnnouncement: false,
			notificationsEnabled: false,
		},
		...overrides,
	};
}

describe('WgHomePage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise(() => {})),
		);
	});

	it('encodes the WG code in immediately visible navigation links', async () => {
		render(<WgHomePage />);

		expect(await screen.findByRole('link', { name: 'WG-Einstellungen öffnen' })).toHaveAttribute(
			'href',
			'/wg/WG%2F123%3Fx%3D1/einstellungen',
		);
		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/dashboard', {
				cache: 'no-store',
				headers: { 'x-manawg-member-id': 'member-1' },
			}),
		);
	});

	it('renders the dashboard retry action as a touch-sized control', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			clone: () => ({
				json: async () => ({ code: 'unexpected_error' }),
			}),
		} as Response);

		render(<WgHomePage />);

		expect(await screen.findByRole('button', { name: 'Dashboard erneut laden' })).toHaveClass(
			'h-11',
		);
	});

	it('removes setup, sharing, and reminder blocks and collapses WG health', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				createDashboardData({
					wgHealth: {
						score: 80,
						label: 'Ein paar Dinge offen',
						items: [],
					},
				}),
		} as Response);

		render(<WgHomePage />);

		const health = await screen.findByText('WG-Gesundheit');
		expect(health.closest('details')).not.toHaveAttribute('open');
		expect(screen.getByText('Letzte Aktivität').closest('details')).not.toHaveAttribute('open');
		expect(screen.queryByText('Saldo pro Mitglied')).not.toBeInTheDocument();
		expect(screen.queryByText('WG einrichten')).not.toBeInTheDocument();
		expect(screen.queryByText('Kurz klären')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /WG-Code .* teilen/ })).not.toBeInTheDocument();
	});

	it('renders my open announcement shortcuts as touch-sized controls', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				createDashboardData({
					myOpenAnnouncements: [
						{
							id: 'announcement-1',
							kind: 'request',
							content: 'Milch kaufen',
							createdAt: '2026-05-18T12:00:00.000Z',
						},
					],
				}),
		} as Response);

		render(<WgHomePage />);

		expect(await screen.findByRole('link', { name: 'Milch kaufen' })).toHaveClass('min-h-[48px]');
	});

	it('renders today list shortcuts as touch-sized controls', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				createDashboardData({
					openShoppingTop: ['Hafermilch'],
					myOpenAnnouncements: [
						{
							id: 'announcement-1',
							kind: 'request',
							content: 'Milch kaufen',
							createdAt: '2026-05-18T12:00:00.000Z',
						},
					],
				}),
		} as Response);

		render(<WgHomePage />);

		expect(await screen.findByRole('link', { name: /Hafermilch fehlt noch/ })).toHaveClass(
			'min-h-[48px]',
		);
	});
});

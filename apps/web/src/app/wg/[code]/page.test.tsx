import type { DashboardData } from '@/core/reads/dashboard-data';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WgHomePage from './page';

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
		members: [{ id: 'member-1', name: 'Ava', color: null }],
		identity: { memberId: 'member-1', name: 'Ava' },
	}),
}));

vi.mock('@/shared/components/theme/ThemeToggle', () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
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
		apiClientMock.apiFetch.mockReturnValue(new Promise(() => {}));
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
		await waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/activity', {
				memberId: 'member-1',
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

	it('renders the onboarding next action as a touch-sized control', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => createDashboardData(),
		} as Response);

		render(<WgHomePage />);

		const inviteActions = await screen.findAllByRole('link', { name: 'Mitglieder einladen' });

		expect(inviteActions[0]).toHaveClass('h-11');
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

	it('renders reminder shortcuts as touch-sized controls', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () =>
				createDashboardData({ setup: { ...createDashboardData().setup, hasExpense: true } }),
		} as Response);
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: {
				reminders: [
					{
						kind: 'announcement',
						title: 'Badplan klären',
						detail: 'Pinnwand offen',
						href: '/pinnwand#announcement-1',
					},
				],
			},
		});

		render(<WgHomePage />);

		expect(await screen.findByRole('link', { name: /Badplan klären/ })).toHaveClass('min-h-[48px]');
	});
});

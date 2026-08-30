import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WgContextProvider } from './WgContextProvider';

const identityMock = vi.hoisted(() => ({
	getIdentity: vi.fn(),
	rememberWg: vi.fn(),
}));
const apiClientMock = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
const offlineClientMock = vi.hoisted(() => ({
	countOfflineActions: vi.fn(),
	syncOfflineActions: vi.fn(),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

vi.mock('@/shared/lib/identity', () => ({
	getIdentity: (...args: unknown[]) => identityMock.getIdentity(...args),
	rememberWg: (...args: unknown[]) => identityMock.rememberWg(...args),
}));

vi.mock('@/core/offline/offline-client', () => ({
	countOfflineActions: (...args: unknown[]) => offlineClientMock.countOfflineActions(...args),
	syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
}));

describe('WgContextProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		identityMock.getIdentity.mockReturnValue(null);
		apiClientMock.apiFetch.mockImplementation((path: string) =>
			path.endsWith('/members')
				? Promise.resolve({
						ok: true,
						data: { members: [{ id: 'member-1', name: 'Ava', color: null }] },
					})
				: Promise.resolve({
						ok: true,
						data: { currentMember: { memberId: 'member-1', name: 'Ava' } },
					}),
		);
		offlineClientMock.countOfflineActions.mockReturnValue(1);
		offlineClientMock.syncOfflineActions.mockReturnValue(new Promise(() => {}));
	});

	it('does not start duplicate automatic offline syncs from repeated app events', async () => {
		render(
			<WgContextProvider
				wg={{
					id: 'wg-1',
					name: 'Test WG',
					shareCode: 'MTE8PZAT',
					joiningEnabled: true,
				}}
				members={[{ id: 'member-1', name: 'Ava', color: null, active: true }]}
			>
				<div>WG bereit</div>
			</WgContextProvider>,
		);

		expect(await screen.findByText('WG bereit')).toBeVisible();

		await act(async () => {
			window.dispatchEvent(new Event('focus'));
			window.dispatchEvent(new Event('online'));
		});

		expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledTimes(1);
		expect(offlineClientMock.countOfflineActions).toHaveBeenCalledWith('MTE8PZAT', {
			memberId: 'member-1',
		});
		expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledWith('MTE8PZAT', {
			memberId: 'member-1',
		});
	});

	it('keeps automatic offline sync retryable after a failed attempt', async () => {
		offlineClientMock.syncOfflineActions
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce(1);

		render(
			<WgContextProvider
				wg={{
					id: 'wg-1',
					name: 'Test WG',
					shareCode: 'MTE8PZAT',
					joiningEnabled: true,
				}}
				members={[{ id: 'member-1', name: 'Ava', color: null, active: true }]}
			>
				<div>WG bereit</div>
			</WgContextProvider>,
		);

		expect(await screen.findByText('WG bereit')).toBeVisible();
		await vi.waitFor(() => expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledTimes(1));

		await act(async () => {
			window.dispatchEvent(new Event('focus'));
		});

		await vi.waitFor(() => expect(offlineClientMock.syncOfflineActions).toHaveBeenCalledTimes(2));
	});

	it('encodes the WG code when refreshing members', async () => {
		render(
			<WgContextProvider
				wg={{
					id: 'wg-1',
					name: 'Test WG',
					shareCode: 'WG/123?x=1',
					joiningEnabled: true,
				}}
				members={[{ id: 'member-1', name: 'Ava', color: null, active: true }]}
			>
				<div>WG bereit</div>
			</WgContextProvider>,
		);

		expect(await screen.findByText('WG bereit')).toBeVisible();

		await vi.waitFor(() =>
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/members'),
		);
	});

	it('keeps the database-free Playwright fixture usable without a Supabase session', async () => {
		vi.stubEnv('NEXT_PUBLIC_DB_DOWN', 'true');
		vi.stubEnv('NEXT_PUBLIC_E2E_FIXTURE_MODE', 'true');
		identityMock.getIdentity.mockReturnValue({ memberId: 'member-1', name: 'Ava' });
		apiClientMock.apiFetch.mockImplementation((path: string) =>
			path.endsWith('/members')
				? Promise.resolve({
						ok: true,
						data: { members: [{ id: 'member-1', name: 'Ava', color: null }] },
					})
				: Promise.resolve({ ok: true, data: { wg: { id: 'wg-1' } } }),
		);

		render(
			<WgContextProvider
				wg={{ id: 'wg-1', name: 'Test WG', shareCode: 'MTE8PZAT', joiningEnabled: true }}
				members={[{ id: 'member-1', name: 'Ava', color: null, active: true }]}
			>
				<div>WG bereit</div>
			</WgContextProvider>,
		);

		expect(await screen.findByText('WG bereit')).toBeVisible();
		vi.unstubAllEnvs();
	});

	it.each(['not_a_member', 'auth_required'])(
		'returns to account selection when member refresh fails with %s',
		async (error) => {
			apiClientMock.apiFetch.mockImplementation((path: string) =>
				path.endsWith('/members')
					? Promise.resolve({ ok: false, status: 401, error })
					: Promise.resolve({
							ok: true,
							data: { currentMember: { memberId: 'member-1', name: 'Ava' } },
						}),
			);

			await act(async () => {
				render(
					<WgContextProvider
						wg={{
							id: 'wg-1',
							name: 'Test WG',
							shareCode: 'MTE8PZAT',
							joiningEnabled: true,
						}}
						members={[{ id: 'member-2', name: 'Ben', color: null, active: true }]}
					>
						<div>WG bereit</div>
					</WgContextProvider>,
				);
			});

			expect(await screen.findByText('Wähle dein Profil')).toBeVisible();
			expect(screen.queryByText('WG bereit')).not.toBeInTheDocument();
		},
	);
});

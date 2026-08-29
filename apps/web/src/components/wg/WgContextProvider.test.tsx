import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WgContextProvider } from './WgContextProvider';

const identityMock = vi.hoisted(() => ({
	clearIdentity: vi.fn(),
	getIdentity: vi.fn(),
	rememberWg: vi.fn(),
	setIdentity: vi.fn(),
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
	clearIdentity: (...args: unknown[]) => identityMock.clearIdentity(...args),
	getIdentity: (...args: unknown[]) => identityMock.getIdentity(...args),
	rememberWg: (...args: unknown[]) => identityMock.rememberWg(...args),
	setIdentity: (...args: unknown[]) => identityMock.setIdentity(...args),
}));

vi.mock('@/core/offline/offline-client', () => ({
	countOfflineActions: (...args: unknown[]) => offlineClientMock.countOfflineActions(...args),
	syncOfflineActions: (...args: unknown[]) => offlineClientMock.syncOfflineActions(...args),
}));

describe('WgContextProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		identityMock.getIdentity.mockReturnValue({ memberId: 'member-1', name: 'Ava' });
		apiClientMock.apiFetch.mockResolvedValue({
			ok: true,
			data: { members: [{ id: 'member-1', name: 'Ava', color: null }] },
		});
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
			expect(apiClientMock.apiFetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/members', {
				memberId: 'member-1',
			}),
		);
	});

	it.each(['not_a_member', 'member_id_required', 'member_id_invalid'])(
		'clears stale local identity when member refresh fails with %s',
		async (error) => {
			apiClientMock.apiFetch.mockResolvedValue({
				ok: false,
				status: 401,
				error,
			});

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

			await vi.waitFor(() => expect(identityMock.clearIdentity).toHaveBeenCalledWith('wg-1'));

			expect(await screen.findByText('Wähle dein Profil')).toBeVisible();
			expect(screen.queryByText('WG bereit')).not.toBeInTheDocument();
		},
	);
});

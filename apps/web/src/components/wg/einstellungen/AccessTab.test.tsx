import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessTab } from './AccessTab';

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const useWgMock = vi.hoisted(() => vi.fn());
const apiClientMock = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('next/navigation', () => ({
	useRouter: () => routerMock,
}));

vi.mock('@/components/wg/WgContextProvider', () => ({
	useWg: () => useWgMock(),
}));

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiClientMock.apiFetch(...args),
}));

const wg = {
	id: 'wg-1',
	name: 'Test WG',
	shareCode: 'ABCDEFGH',
	joiningEnabled: true,
	shareCodeRotatedAt: null,
};

const members = [
	{ id: 'member-1', name: 'Ava', color: null, active: true },
	{ id: 'member-2', name: 'Ben', color: null, active: true },
];

const identity = { memberId: 'member-1', name: 'Ava' };

describe('AccessTab', () => {
	beforeEach(() => {
		useWgMock.mockReturnValue({ refreshMembers: vi.fn(), isAdmin: false });
	});

	it('does not offer deactivating another member when the viewer is not admin', () => {
		render(<AccessTab wg={wg} members={members} identity={identity} />);

		expect(screen.queryByRole('button', { name: 'Ben ausziehen' })).not.toBeInTheDocument();
	});

	it('offers deactivating another member when the viewer is admin', () => {
		useWgMock.mockReturnValue({ refreshMembers: vi.fn(), isAdmin: true });

		render(<AccessTab wg={wg} members={members} identity={identity} />);

		expect(screen.getByRole('button', { name: 'Ben ausziehen' })).toBeInTheDocument();
	});
});

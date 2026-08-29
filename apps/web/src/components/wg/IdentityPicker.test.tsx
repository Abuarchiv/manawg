import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityPicker } from './IdentityPicker';

const identityMock = vi.hoisted(() => ({
	setIdentity: vi.fn(),
}));

vi.mock('@/shared/lib/identity', () => ({
	setIdentity: (...args: unknown[]) => identityMock.setIdentity(...args),
}));

describe('IdentityPicker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise(() => {
						// keep request pending to test duplicate-submit protection
					}),
			),
		);
	});

	it('does not create duplicate member requests from repeated submits', () => {
		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={() => undefined}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);
		fireEvent.submit(form);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(screen.getByLabelText('Dein Name')).toBeDisabled();
		expect(screen.getByRole('button', { name: 'WG betreten' })).toBeDisabled();
	});

	it('encodes the WG code when creating a new member', () => {
		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="WG/123?x=1"
				wgName="Test WG"
				members={[]}
				onPicked={() => undefined}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(fetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/members', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Ava' }),
		});
	});

	it('keeps navigation back to member picking disabled while creating a member', () => {
		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[{ id: 'member-1', name: 'Ava', color: null }]}
				onPicked={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ich bin neu hier' }));
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(screen.getByRole('button', { name: 'Zurück' })).toBeDisabled();
	});

	it('renders member creation actions as touch-sized controls', () => {
		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[{ id: 'member-1', name: 'Ava', color: null }]}
				onPicked={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ich bin neu hier' }));

		expect(screen.getByLabelText('Dein Name')).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'Zurück' })).toHaveClass('h-11');
		expect(screen.getByRole('button', { name: 'WG betreten' })).toHaveClass('h-11');
	});

	it('stores an existing picked member without a network request', () => {
		const onPicked = vi.fn();
		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[{ id: 'member-1', name: 'Ava', color: null }]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: /Ava/ }));

		expect(identityMock.setIdentity).toHaveBeenCalledWith('wg-1', {
			memberId: 'member-1',
			name: 'Ava',
		});
		expect(onPicked).toHaveBeenCalledWith({ memberId: 'member-1', name: 'Ava' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('keeps existing-member picking retryable when browser storage is blocked', () => {
		identityMock.setIdentity.mockImplementation(() => {
			throw new Error('storage blocked');
		});
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[{ id: 'member-1', name: 'Ava', color: null }]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: /Ava/ }));

		expect(onPicked).not.toHaveBeenCalled();
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Profil konnte auf diesem Gerät nicht gespeichert werden.',
		);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('separates member creation success from local identity storage failure', async () => {
		identityMock.setIdentity.mockImplementation(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ member: { id: 'member-2', name: 'Noah', color: null } }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		expect(onPicked).not.toHaveBeenCalled();
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Profil konnte auf diesem Gerät nicht gespeichert werden.',
		);
		expect(screen.queryByText('Netzwerkfehler.')).not.toBeInTheDocument();
	});

	it('explains when direct member creation is blocked because joining is disabled', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 403,
			clone: () =>
				({
					json: async () => ({ code: 'joining_disabled' }),
				}) as Response,
			json: async () => ({ code: 'joining_disabled' }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Diese WG nimmt gerade keine neuen Beitritte an.',
		);
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});

	it('explains when the WG has reached its member limit', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 409,
			clone: () =>
				({
					json: async () => ({ code: 'member_limit_reached' }),
				}) as Response,
			json: async () => ({ code: 'member_limit_reached' }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent('Diese WG ist voll.');
		expect(screen.queryByText('Name in dieser WG bereits vergeben.')).not.toBeInTheDocument();
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});

	it('explains when direct member creation uses a stale WG link', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 404,
			clone: () =>
				({
					json: async () => ({ error: 'wg_not_found' }),
				}) as Response,
			json: async () => ({ error: 'wg_not_found' }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Diese WG wurde nicht gefunden. Öffne sie über den aktuellen WG-Link erneut.',
		);
		expect(screen.queryByText('Konnte Mitglied nicht anlegen.')).not.toBeInTheDocument();
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});

	it('explains network failures while creating a new member', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('Failed to fetch'));
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Beitritt konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(screen.queryByText('Netzwerkfehler.')).not.toBeInTheDocument();
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});

	it('explains unexpected server failures while creating a new member', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			clone: () =>
				({
					json: async () => ({ error: 'unexpected_error' }),
				}) as Response,
			json: async () => ({ error: 'unexpected_error' }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Beitritt konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(screen.queryByText('Konnte Mitglied nicht anlegen.')).not.toBeInTheDocument();
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});

	it('explains server_error failures while creating a new member', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			clone: () =>
				({
					json: async () => ({ error: 'server_error' }),
				}) as Response,
			json: async () => ({ error: 'server_error' }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Beitritt konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(screen.queryByText('Konnte Mitglied nicht anlegen.')).not.toBeInTheDocument();
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});

	it('explains db_error failures while creating a new member', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 503,
			clone: () =>
				({
					json: async () => ({ error: 'db_error' }),
				}) as Response,
			json: async () => ({ error: 'db_error' }),
		} as Response);
		const onPicked = vi.fn();

		render(
			<IdentityPicker
				wgId="wg-1"
				wgShareCode="MTE8PZAT"
				wgName="Test WG"
				members={[]}
				onPicked={onPicked}
			/>,
		);

		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Noah' } });
		const form = screen.getByRole('button', { name: 'WG betreten' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Beitritt konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(screen.queryByText('Konnte Mitglied nicht anlegen.')).not.toBeInTheDocument();
		expect(identityMock.setIdentity).not.toHaveBeenCalled();
		expect(onPicked).not.toHaveBeenCalled();
	});
});

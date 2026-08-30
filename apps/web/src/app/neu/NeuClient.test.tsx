import { InviteStep } from '@/components/neu/InviteStep';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NeuClient } from './NeuClient';

const routerMock = vi.hoisted(() => ({
	push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
	useRouter: () => routerMock,
	// NeuClient reads `?action=create` from the URL via useSearchParams. Back it
	// with the live location so tests that drive URL state via history.pushState
	// keep working, and the default `/neu` route yields no `action`.
	useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
	vi.clearAllMocks();
	window.localStorage.clear();
	window.history.pushState({}, '', '/neu');
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('InviteStep', () => {
	it('copies the invite text when native share fails', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: vi.fn().mockRejectedValue(new Error('not allowed')),
		});

		render(<InviteStep code="MTE8PZAT" wgName="Test WG" onSkip={() => undefined} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mitbewohner einladen' }));

		expect(await screen.findByRole('button', { name: 'Geteilt' })).toBeVisible();
		expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/neu?code=MTE8PZAT'));
	});

	it('uses the manual copy fallback when clipboard is blocked', async () => {
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, 'execCommand', {
			configurable: true,
			value: execCommand,
		});
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: undefined,
		});

		render(<InviteStep code="MTE8PZAT" wgName="Test WG" onSkip={() => undefined} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mitbewohner einladen' }));

		expect(await screen.findByRole('button', { name: 'Geteilt' })).toBeVisible();
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('shows failed state when all share and copy methods are blocked', async () => {
		Object.defineProperty(document, 'execCommand', {
			configurable: true,
			value: vi.fn().mockReturnValue(false),
		});
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: vi.fn().mockRejectedValue(new Error('not allowed')),
		});

		render(<InviteStep code="MTE8PZAT" wgName="Test WG" onSkip={() => undefined} />);

		fireEvent.click(screen.getByRole('button', { name: 'Mitbewohner einladen' }));

		expect(await screen.findByRole('button', { name: 'Teilen fehlgeschlagen' })).toBeVisible();
	});

	it('does not start duplicate invite shares while one share is pending', async () => {
		let finishShare: (() => void) | undefined;
		const share = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishShare = resolve;
				}),
		);
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: share,
		});

		render(<InviteStep code="MTE8PZAT" wgName="Test WG" onSkip={() => undefined} />);

		const inviteButton = screen.getByRole('button', { name: 'Mitbewohner einladen' });
		fireEvent.click(inviteButton);
		fireEvent.click(inviteButton);

		expect(share).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Einladung wird geteilt…' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Code MTE8PZAT kopieren' })).toBeDisabled();
		expect(screen.getByRole('link', { name: 'Per WhatsApp teilen' })).toHaveAttribute(
			'aria-disabled',
			'true',
		);
		expect(screen.getByRole('button', { name: /Später/ })).toBeDisabled();

		await act(async () => {
			finishShare?.();
		});

		expect(await screen.findByRole('button', { name: 'Geteilt' })).toBeVisible();
	});

	it('exposes WhatsApp sharing as a single descriptive link', () => {
		render(<InviteStep code="MTE8PZAT" wgName="Test WG" onSkip={() => undefined} />);

		expect(screen.getByRole('link', { name: 'Per WhatsApp teilen' })).toBeVisible();
		expect(screen.queryByRole('img', { name: 'WhatsApp' })).not.toBeInTheDocument();
	});

	it('does not copy the invite code twice while copying is pending', async () => {
		let finishCopy: (() => void) | undefined;
		const writeText = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishCopy = resolve;
				}),
		);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});

		render(<InviteStep code="MTE8PZAT" wgName="Test WG" onSkip={() => undefined} />);

		const codeButton = screen.getByRole('button', { name: 'Code MTE8PZAT kopieren' });
		fireEvent.click(codeButton);
		fireEvent.click(codeButton);

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Code MTE8PZAT wird kopiert…' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Mitbewohner einladen' })).toBeDisabled();
		expect(screen.getByRole('link', { name: 'Per WhatsApp teilen' })).toHaveAttribute(
			'aria-disabled',
			'true',
		);
		expect(screen.getByRole('button', { name: /Später/ })).toBeDisabled();

		await act(async () => {
			finishCopy?.();
		});

		expect(await screen.findByRole('button', { name: 'Geteilt' })).toBeVisible();
	});
});

describe('NeuClient account setup', () => {
	it('offers social login and restored WGs without local device data', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ wgs: [{ id: 'wg-1', code: 'MTE8PZAT', name: 'Küche 4' }] }),
			}),
		);

		render(<NeuClient />);

		expect(await screen.findByRole('button', { name: 'Mit Google anmelden' })).toBeVisible();
		expect(await screen.findByRole('button', { name: 'Küche 4' })).toBeVisible();
	});

	it('offers Google, Apple and Facebook before creating a WG', async () => {
		render(<NeuClient />);
		fireEvent.click(await screen.findByRole('button', { name: /Neue WG erstellen/ }));

		expect(screen.getByRole('button', { name: 'Mit Google anmelden' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Mit Apple anmelden' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'Mit Facebook anmelden' })).toBeVisible();
	});
});

describe('NeuClient', () => {
	it('restores a started WG creation draft after reload', async () => {
		window.localStorage.setItem(
			'manawg:draft:neu',
			JSON.stringify({
				step: 'create',
				wgName: 'Fast fertige WG',
				creatorName: 'Ava',
			}),
		);

		render(<NeuClient />);

		expect(await screen.findByLabelText('WG-Name')).toHaveValue('Fast fertige WG');
		expect(screen.getByLabelText('Dein Name')).toHaveValue('Ava');
	});

	it('prefers an invite link code over an older local start draft', async () => {
		window.localStorage.setItem(
			'manawg:draft:neu',
			JSON.stringify({
				step: 'create',
				wgName: 'Alter Entwurf',
				joinCode: 'ABCDEFGH',
			}),
		);
		window.history.pushState({}, '', '/neu?code=MTE8PZAT');

		render(<NeuClient />);

		expect(await screen.findByLabelText('WG-Code')).toHaveValue('MTE8PZAT');
		expect(screen.queryByLabelText('WG-Name')).not.toBeInTheDocument();
	});

	it('restores a verified join draft so users do not need to re-check the code', async () => {
		window.localStorage.setItem(
			'manawg:draft:neu',
			JSON.stringify({
				step: 'joinName',
				joinCode: 'MTE8PZAT',
				joinName: 'Samira',
				joinWg: { id: 'wg-1', code: 'MTE8PZAT', name: 'Test WG' },
			}),
		);

		render(<NeuClient />);

		expect(await screen.findByText('Test WG')).toBeVisible();
		expect(screen.getByText('MTE8PZAT')).toBeVisible();
		expect(screen.getByLabelText('Dein Name')).toHaveValue('Samira');
		expect(screen.getByRole('button', { name: 'WG beitreten' })).toBeVisible();
	});

	it('falls back to code entry when a verified join draft has no WG snapshot', async () => {
		window.localStorage.setItem(
			'manawg:draft:neu',
			JSON.stringify({
				step: 'joinName',
				joinCode: 'MTE8PZAT',
				joinName: 'Samira',
			}),
		);

		render(<NeuClient />);

		expect(await screen.findByLabelText('WG-Code')).toHaveValue('MTE8PZAT');
		expect(screen.queryByRole('button', { name: 'WG beitreten' })).not.toBeInTheDocument();
	});

	it('clears the start draft after creating a WG successfully', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					wg: { id: 'wg-1', shareCode: 'MTE8PZAT', name: 'Test WG' },
					creator: { id: 'member-1', name: 'Ava' },
				}),
			}),
		);

		render(<NeuClient />);

		fireEvent.click(await screen.findByRole('button', { name: /Neue WG erstellen/ }));
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		await waitFor(() => expect(window.localStorage.getItem('manawg:draft:neu')).not.toBeNull());
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');
		fireEvent.submit(form);

		await screen.findByText('Test WG ist live.');
		expect(window.localStorage.getItem('manawg:draft:neu')).toBeNull();
	});

	it('creates a WG without writing a local member identity', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					wg: { id: 'wg-1', shareCode: 'MTE8PZAT', name: 'Test WG' },
					creator: { id: 'member-1', name: 'Ava' },
				}),
			}),
		);

		render(<NeuClient />);

		fireEvent.click(await screen.findByRole('button', { name: /Neue WG erstellen/ }));
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		await waitFor(() => expect(window.localStorage.getItem('manawg:draft:neu')).not.toBeNull());
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(await screen.findByText('Test WG ist live.')).toBeVisible();
		expect(window.localStorage.getItem('manawg_identity:wg-1')).toBeNull();
	});

	it('does not send duplicate WG creation requests from repeated submits', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise(() => {
						// keep pending to exercise the busy guard
					}),
			),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);
		fireEvent.submit(form);

		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('explains invalid WG creation responses without raw API codes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 400,
				clone: () =>
					({
						json: async () => ({ code: 'invalid_body' }),
					}) as Response,
				json: async () => ({ code: 'invalid_body' }),
			}),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText('WG-Name und dein Name müssen ausgefüllt und kurz genug sein.'),
		).toBeVisible();
		expect(screen.queryByText('invalid_body')).not.toBeInTheDocument();
	});

	it('explains field-specific WG creation validation responses', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({ ok: false, status: 401 })
				.mockResolvedValueOnce({
					ok: false,
					status: 400,
					clone: () =>
						({
							json: async () => ({ error: 'name_invalid' }),
						}) as Response,
					json: async () => ({ error: 'name_invalid' }),
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 400,
					clone: () =>
						({
							json: async () => ({ error: 'creator_name_invalid' }),
						}) as Response,
					json: async () => ({ error: 'creator_name_invalid' }),
				}),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);
		expect(
			await screen.findByText(
				'WG konnte nicht erstellt werden: Der WG-Name muss 1 bis 100 Zeichen haben.',
			),
		).toBeVisible();

		fireEvent.submit(form);
		expect(
			await screen.findByText(
				'WG konnte nicht erstellt werden: Dein Name muss 1 bis 80 Zeichen haben.',
			),
		).toBeVisible();
		expect(screen.queryByText('name_invalid')).not.toBeInTheDocument();
		expect(screen.queryByText('creator_name_invalid')).not.toBeInTheDocument();
	});

	it('explains temporary share-code exhaustion while creating a WG', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				clone: () =>
					({
						json: async () => ({ error: 'share_code_exhausted' }),
					}) as Response,
				json: async () => ({ error: 'share_code_exhausted' }),
			}),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText(
				'Gerade konnte kein WG-Code erstellt werden. Bitte versuche es gleich noch einmal.',
			),
		).toBeVisible();
		expect(screen.queryByText('Konnte WG nicht erstellen.')).not.toBeInTheDocument();
	});

	it('explains partial WG creation failures without moving to invite', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				clone: () =>
					({
						json: async () => ({ error: 'member_insert_failed' }),
					}) as Response,
				json: async () => ({ error: 'member_insert_failed' }),
			}),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText(
				'WG konnte nicht vollständig erstellt werden. Bitte versuche es erneut.',
			),
		).toBeVisible();
		expect(screen.queryByText('member_insert_failed')).not.toBeInTheDocument();
		expect(screen.queryByText('Test WG ist live.')).not.toBeInTheDocument();
	});

	it('explains server failures while creating a WG as retryable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				clone: () =>
					({
						json: async () => ({ error: 'server_error' }),
					}) as Response,
				json: async () => ({ error: 'server_error' }),
			}),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText('WG konnte nicht erstellt werden: Versuche es gleich erneut.'),
		).toBeVisible();
		expect(screen.queryByText('Konnte WG nicht erstellen.')).not.toBeInTheDocument();
		expect(screen.queryByText('Test WG ist live.')).not.toBeInTheDocument();
	});

	it('explains db_error failures while creating a WG as retryable', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 503,
				clone: () =>
					({
						json: async () => ({ error: 'db_error' }),
					}) as Response,
				json: async () => ({ error: 'db_error' }),
			}),
		);

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText('WG konnte nicht erstellt werden: Versuche es gleich erneut.'),
		).toBeVisible();
		expect(screen.queryByText('Konnte WG nicht erstellen.')).not.toBeInTheDocument();
		expect(screen.queryByText('Test WG ist live.')).not.toBeInTheDocument();
	});

	it('explains network failures while creating a WG', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

		render(<NeuClient />);

		const createChoice = await screen.findByRole('button', { name: /Neue WG erstellen/ });
		await waitFor(() => expect(createChoice).toBeEnabled());
		fireEvent.click(createChoice);
		fireEvent.change(screen.getByLabelText('WG-Name'), { target: { value: 'Test WG' } });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Ava' } });
		const form = screen.getByRole('button', { name: 'WG erstellen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText(
				'WG konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible();
		expect(screen.queryByText('Netzwerkfehler.')).not.toBeInTheDocument();
	});

	it('does not send duplicate join-code verification requests from repeated submits', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise(() => {
						// keep pending to exercise the busy guard
					}),
			),
		);

		render(<NeuClient />);

		const joinChoice = await screen.findByRole('button', { name: /Per Code beitreten/ });
		await waitFor(() => expect(joinChoice).toBeEnabled());
		fireEvent.click(joinChoice);
		fireEvent.change(screen.getByLabelText('WG-Code'), { target: { value: 'MTE8PZAT' } });
		const form = screen.getByRole('button', { name: 'WG-Code prüfen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);
		fireEvent.submit(form);

		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('uses API error codes while checking a WG code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				clone: () =>
					({
						json: async () => ({ code: 'wg_not_found' }),
					}) as Response,
				json: async () => ({ code: 'wg_not_found' }),
			}),
		);

		render(<NeuClient />);

		const joinChoice = await screen.findByRole('button', { name: /Per Code beitreten/ });
		await waitFor(() => expect(joinChoice).toBeEnabled());
		fireEvent.click(joinChoice);
		fireEvent.change(screen.getByLabelText('WG-Code'), { target: { value: 'MTE8PZAT' } });
		const form = screen.getByRole('button', { name: 'WG-Code prüfen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(await screen.findByText('Diesen WG-Code gibt es nicht.')).toBeVisible();
		expect(
			screen.queryByText('Hat nicht geklappt. Bitte nochmal versuchen.'),
		).not.toBeInTheDocument();
	});

	it('falls back to the WG route when invite verification incorrectly asks for a member id', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
				clone: () =>
					({
						json: async () => ({ code: 'member_id_required' }),
					}) as Response,
				json: async () => ({ code: 'member_id_required' }),
			}),
		);

		render(<NeuClient />);

		const joinChoice = await screen.findByRole('button', { name: /Per Code beitreten/ });
		await waitFor(() => expect(joinChoice).toBeEnabled());
		fireEvent.click(joinChoice);
		fireEvent.change(screen.getByLabelText('WG-Code'), { target: { value: 'mte8pzat' } });
		const form = screen.getByRole('button', { name: 'WG-Code prüfen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/wg/MTE8PZAT'));
		expect(
			screen.queryByText('Hat nicht geklappt. Bitte nochmal versuchen.'),
		).not.toBeInTheDocument();
	});

	it('stops new joins as soon as a checked WG has joining disabled', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					wg: {
						id: 'wg-1',
						shareCode: 'MTE8PZAT',
						name: 'Test WG',
						joiningEnabled: false,
					},
				}),
			}),
		);

		render(<NeuClient />);

		const joinChoice = await screen.findByRole('button', { name: /Per Code beitreten/ });
		await waitFor(() => expect(joinChoice).toBeEnabled());
		fireEvent.click(joinChoice);
		fireEvent.change(screen.getByLabelText('WG-Code'), { target: { value: 'MTE8PZAT' } });
		const form = screen.getByRole('button', { name: 'WG-Code prüfen' }).closest('form');
		if (!form) throw new Error('form missing');

		fireEvent.submit(form);

		expect(
			await screen.findByText('Diese WG nimmt gerade keine neuen Beitritte an.'),
		).toBeVisible();
		expect(screen.queryByRole('button', { name: 'WG beitreten' })).not.toBeInTheDocument();
		expect(window.localStorage.getItem('manawg_known_wgs')).toBeNull();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('encodes API-provided WG codes when the account already belongs to the WG', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					wg: {
						id: 'wg-1',
						shareCode: 'WG/123?x=1',
						name: 'Test WG',
						joiningEnabled: true,
					},
					currentMember: { memberId: 'member-1', name: 'Samira' },
				}),
			}),
		);

		render(<NeuClient />);

		const joinChoice = await screen.findByRole('button', { name: /Per Code beitreten/ });
		await waitFor(() => expect(joinChoice).toBeEnabled());
		fireEvent.click(joinChoice);
		fireEvent.change(screen.getByLabelText('WG-Code'), { target: { value: 'MTE8PZAT' } });
		const form = screen.getByRole('button', { name: 'WG-Code prüfen' }).closest('form');
		if (!form) throw new Error('code form missing');
		fireEvent.submit(form);

		await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/wg/WG%2F123%3Fx%3D1'));
	});

	it('encodes restored WG codes when joining after a saved draft', async () => {
		window.localStorage.setItem(
			'manawg:draft:neu',
			JSON.stringify({
				step: 'joinName',
				joinWg: { id: 'wg-1', code: 'WG/123?x=1', name: 'Test WG' },
			}),
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise(() => {
						// keep pending so the request can be inspected
					}),
			),
		);

		render(<NeuClient />);

		await screen.findByRole('button', { name: 'WG beitreten' });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Samira' } });
		const form = screen.getByRole('button', { name: 'WG beitreten' }).closest('form');
		if (!form) throw new Error('join form missing');
		fireEvent.submit(form);

		expect(fetch).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/members', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Samira' }),
		});
	});

	it('joins an existing WG without writing a local member identity', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({ ok: false, status: 401 })
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						wg: {
							id: 'wg-1',
							shareCode: 'MTE8PZAT',
							name: 'Test WG',
							joiningEnabled: true,
						},
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ member: { id: 'member-1', name: 'Samira' } }),
				}),
		);

		render(<NeuClient />);

		const joinChoice = await screen.findByRole('button', { name: /Per Code beitreten/ });
		await waitFor(() => expect(joinChoice).toBeEnabled());
		fireEvent.click(joinChoice);
		fireEvent.change(screen.getByLabelText('WG-Code'), { target: { value: 'MTE8PZAT' } });
		let form = screen.getByRole('button', { name: 'WG-Code prüfen' }).closest('form');
		if (!form) throw new Error('code form missing');
		fireEvent.submit(form);

		await screen.findByRole('button', { name: 'WG beitreten' });
		fireEvent.change(screen.getByLabelText('Dein Name'), { target: { value: 'Samira' } });
		form = screen.getByRole('button', { name: 'WG beitreten' }).closest('form');
		if (!form) throw new Error('join form missing');

		fireEvent.submit(form);

		await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith('/wg/MTE8PZAT'));
		expect(window.localStorage.getItem('manawg_identity:wg-1')).toBeNull();
	});
});

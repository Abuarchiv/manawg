import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebtSummary } from './DebtSummary';

const apiFetchMock = vi.fn();

vi.mock('@/core/infra/api-client', () => ({
	apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

describe('DebtSummary', () => {
	beforeEach(() => {
		apiFetchMock.mockReset();
		apiFetchMock.mockReturnValue(new Promise(() => undefined));
	});

	it('does not send duplicate settlement requests from rapid clicks', () => {
		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		const button = screen.getByRole('button', {
			name: 'Ava hat Ben 12,34 € bezahlt',
		});
		fireEvent.click(button);
		fireEvent.click(button);

		expect(apiFetchMock).toHaveBeenCalledTimes(1);
	});

	it('encodes the WG code in settlement API calls', () => {
		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="WG/123?x=1"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

		expect(apiFetchMock).toHaveBeenCalledWith('/api/wg/WG%2F123%3Fx%3D1/expenses/settle-batch', {
			method: 'POST',
			memberId: 'member-a',
			body: JSON.stringify({ fromMemberId: 'member-a', toMemberId: 'member-b' }),
		});
	});

	it('keeps long names and payment actions constrained on narrow layouts', () => {
		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Maximilian-Christopher von Hohenzollern-Sigmaringen',
						toId: 'member-b',
						toName: 'Alexandra-Maria von Schleswig-Holstein-Sonderburg',
						cents: 987654,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		expect(screen.getByText('Maximilian-Christopher von Hohenzollern-Sigmaringen')).toHaveClass(
			'truncate',
		);
		expect(screen.getByText('Alexandra-Maria von Schleswig-Holstein-Sonderburg')).toHaveClass(
			'truncate',
		);
		expect(screen.getByText(/9\.876,54\s€/)).toHaveClass('whitespace-nowrap');
		expect(
			screen.getByRole('button', {
				name: 'Maximilian-Christopher von Hohenzollern-Sigmaringen hat Alexandra-Maria von Schleswig-Holstein-Sonderburg 9.876,54 € bezahlt',
			}),
		).toHaveClass('w-full', 'h-11');
	});

	it('shows an inline error when settlement fails', async () => {
		apiFetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			error: 'Serverfehler',
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Ava hat Ben 12,34 € bezahlt',
			}),
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden.',
		);
	});

	it('explains when a settlement member is no longer in the WG', async () => {
		apiFetchMock.mockResolvedValueOnce({
			ok: false,
			status: 400,
			error: 'member_not_in_wg',
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden: Mindestens ein Mitglied ist nicht mehr in dieser WG.',
		);
	});

	it('explains unexpected server failures while settling a debt', async () => {
		apiFetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			error: 'unexpected_error',
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(
			screen.queryByText('Ausgleich konnte nicht gespeichert werden.'),
		).not.toBeInTheDocument();
	});

	it('explains server_error failures while settling a debt', async () => {
		apiFetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			error: 'server_error',
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(
			screen.queryByText('Ausgleich konnte nicht gespeichert werden.'),
		).not.toBeInTheDocument();
	});

	it('explains db_error failures while settling a debt as retryable server failures', async () => {
		apiFetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			error: 'db_error',
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden: Versuche es gleich erneut.',
		);
		expect(
			screen.queryByText('Ausgleich konnte nicht gespeichert werden.'),
		).not.toBeInTheDocument();
	});

	it.each(['not_a_member', 'member_id_invalid'])(
		'explains stale membership when settlement is denied with %s',
		async (error) => {
			apiFetchMock.mockResolvedValueOnce({
				ok: false,
				status: 401,
				error,
			});

			render(
				<DebtSummary
					debts={[
						{
							fromId: 'member-a',
							fromName: 'Ava',
							toId: 'member-b',
							toName: 'Ben',
							cents: 1234,
						},
					]}
					shareCode="MTE8PZAT"
					currentMemberId="member-a"
					memberColor={() => null}
					onSettled={() => undefined}
				/>,
			);

			fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

			expect(await screen.findByRole('alert')).toHaveTextContent(
				'Ausgleich konnte nicht gespeichert werden: Tritt der WG erneut bei.',
			);
			expect(
				screen.queryByText('Ausgleich konnte nicht gespeichert werden.'),
			).not.toBeInTheDocument();
		},
	);

	it('explains when the current member cannot settle this debt', async () => {
		apiFetchMock.mockResolvedValueOnce({
			ok: false,
			status: 403,
			error: 'not_party_to_debt',
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden: Du bist an dieser Schuld nicht beteiligt.',
		);
	});

	it('announces successful settlement before the row disappears from context', async () => {
		const onSettled = vi.fn();
		apiFetchMock.mockResolvedValueOnce({
			ok: true,
			data: { settled: 2 },
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={onSettled}
			/>,
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Ava hat Ben 12,34 € bezahlt',
			}),
		);

		const status = await screen.findByRole('status');
		expect(status).toHaveAttribute('aria-live', 'polite');
		expect(status).toHaveTextContent(/Ausgleich gespeichert: Ava hat Ben 12,34\s€ bezahlt\./);
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('button', { name: 'Ava hat Ben 12,34 € bezahlt' })).toBeNull();
	});

	it('explains when the debt was already settled elsewhere', async () => {
		const onSettled = vi.fn();
		apiFetchMock.mockResolvedValueOnce({
			ok: true,
			data: { settled: 0 },
		});

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={onSettled}
			/>,
		);

		fireEvent.click(
			screen.getByRole('button', {
				name: 'Ava hat Ben 12,34 € bezahlt',
			}),
		);

		expect(await screen.findByRole('status')).toHaveTextContent(
			'Kein offener Ausgleich mehr: Ava und Ben sind bereits ausgeglichen.',
		);
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(screen.queryByText(/Ausgleich gespeichert/)).toBeNull();
	});

	it('explains network failures when the settlement request throws', async () => {
		apiFetchMock.mockRejectedValueOnce(new Error('network down'));

		render(
			<DebtSummary
				debts={[
					{
						fromId: 'member-a',
						fromName: 'Ava',
						toId: 'member-b',
						toName: 'Ben',
						cents: 1234,
					},
				]}
				shareCode="MTE8PZAT"
				currentMemberId="member-a"
				memberColor={() => null}
				onSettled={() => undefined}
			/>,
		);

		const button = screen.getByRole('button', {
			name: 'Ava hat Ben 12,34 € bezahlt',
		});
		fireEvent.click(button);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Ausgleich konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
		);
		expect(button).toBeEnabled();
	});
});

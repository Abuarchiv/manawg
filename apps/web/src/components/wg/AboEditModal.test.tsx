import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AboEditModal } from './AboEditModal';
import type { Abo, MemberOption } from './abos-types';

const abo: Abo = {
	id: 'abo-1',
	description: 'Netflix',
	amountCents: 1200,
	paidByMemberId: 'member-1',
	intervalMonths: 1,
	nextDueAt: '2026-06-01T12:00:00.000Z',
	lastCreatedAt: null,
	pausedAt: null,
	splits: [{ debtorMemberId: 'member-1', amountCents: 1200 }],
};

const members: MemberOption[] = [{ id: 'member-1', name: 'Ada', color: null, active: true }];

function Harness() {
	const [tick, setTick] = useState(0);
	return (
		<>
			<button type="button" onClick={() => setTick((t) => t + 1)}>
				rerender {tick}
			</button>
			<AboEditModal
				abo={abo}
				members={members}
				submitting={false}
				onClose={vi.fn()}
				onSubmit={vi.fn()}
			/>
		</>
	);
}

describe('AboEditModal', () => {
	it('keeps in-progress edits when the parent re-renders for an unrelated reason', () => {
		render(<Harness />);

		const input = screen.getByLabelText('Beschreibung') as HTMLInputElement;
		fireEvent.change(input, { target: { value: 'Netflix Premium' } });
		expect(input.value).toBe('Netflix Premium');

		// Simulate an unrelated parent re-render (e.g. a background action on a
		// different abo finishing) while this edit form stays mounted.
		fireEvent.click(screen.getByText(/rerender/));

		expect(input.value).toBe('Netflix Premium');
	});
});

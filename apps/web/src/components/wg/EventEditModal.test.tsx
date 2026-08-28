import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventEditModal } from './EventEditModal';

const baseEvent = {
	id: 'evt-1',
	title: 'WG-Meeting',
	description: null,
	startsAt: '2026-06-01T08:00:00.000Z',
	endsAt: null,
	allDay: false,
	location: null,
	recurrence: 'FREQ=WEEKLY',
};

describe('EventEditModal', () => {
	it('submits recurrence changes with the update payload', async () => {
		const onUpdate = vi.fn().mockResolvedValue(undefined);
		render(
			<EventEditModal event={baseEvent} onClose={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />,
		);

		fireEvent.change(screen.getByLabelText('Wiederholung'), { target: { value: '' } });
		const form = screen.getByRole('button', { name: 'Speichern' }).closest('form');
		if (!form) throw new Error('expected save button to be inside a form');
		fireEvent.submit(form);

		await waitFor(() => expect(onUpdate).toHaveBeenCalled());
		expect(onUpdate).toHaveBeenCalledWith('evt-1', expect.objectContaining({ recurrence: null }));
	});
});

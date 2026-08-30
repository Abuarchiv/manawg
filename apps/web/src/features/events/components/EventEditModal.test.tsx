import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEditModal } from './EventEditModal';

// jsdom doesn't implement <dialog> showModal()/close() — the nested
// ConfirmDialog needs these stubbed so its imperative calls don't throw.
beforeAll(() => {
	if (!HTMLDialogElement.prototype.showModal) {
		HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
			this.setAttribute('open', '');
		};
	}
	if (!HTMLDialogElement.prototype.close) {
		HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
			this.removeAttribute('open');
		};
	}
});

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

	it('does not collide the dialog heading id with the title input id', () => {
		// Regression: both used the same idPrefix-derived id
		// ("event-edit-title"), so `document.getElementById` (which
		// `<label for>` and `aria-labelledby` rely on) could resolve to the
		// non-focusable <h2> instead of the <input>, silently breaking the
		// "Titel" label's click-to-focus behavior.
		render(
			<EventEditModal event={baseEvent} onClose={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />,
		);

		const titleInput = screen.getByLabelText('Titel');
		expect(titleInput).toBeInstanceOf(HTMLInputElement);
		expect(document.querySelectorAll(`#${titleInput.id}`)).toHaveLength(1);
	});

	it('requires confirmation before deleting, and warns that a recurring event deletes the whole series', async () => {
		// Regression: "Löschen" used to call onDelete directly on click, with
		// no confirmation step at all — unlike every other destructive action
		// in the app (Ausgaben, Abos, Chores all confirm first). A misclick
		// instantly wiped the event, and for a recurring event that means the
		// entire series (there's no per-occurrence row to delete instead).
		const onDelete = vi.fn().mockResolvedValue(undefined);
		render(
			<EventEditModal event={baseEvent} onClose={vi.fn()} onUpdate={vi.fn()} onDelete={onDelete} />,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Termin löschen' }));
		expect(onDelete).not.toHaveBeenCalled();

		const dialog = await screen.findByRole('dialog', { name: 'Termin löschen?' });
		expect(dialog).toHaveTextContent('gesamte Serie');

		const confirmButtons = screen.getAllByRole('button', { name: 'Löschen' });
		// The last "Löschen" button belongs to the ConfirmDialog (the trigger
		// button behind it also reads "Löschen").
		fireEvent.click(confirmButtons.at(-1) as HTMLElement);

		await waitFor(() => expect(onDelete).toHaveBeenCalledWith('evt-1'));
	});

	it('does not mention a series when the event has no recurrence', async () => {
		const onDelete = vi.fn().mockResolvedValue(undefined);
		const singleEvent = { ...baseEvent, recurrence: null };
		render(
			<EventEditModal
				event={singleEvent}
				onClose={vi.fn()}
				onUpdate={vi.fn()}
				onDelete={onDelete}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Termin löschen' }));
		const dialog = await screen.findByRole('dialog', { name: 'Termin löschen?' });
		expect(dialog).not.toHaveTextContent('Serie');

		const confirmButtons = screen.getAllByRole('button', { name: 'Löschen' });
		// The last "Löschen" button belongs to the ConfirmDialog (the trigger
		// button behind it also reads "Löschen").
		fireEvent.click(confirmButtons.at(-1) as HTMLElement);

		await waitFor(() => expect(onDelete).toHaveBeenCalledWith('evt-1'));
	});

	it('keeps the delete confirmation open when Escape is pressed', async () => {
		const onClose = vi.fn();
		render(
			<EventEditModal event={baseEvent} onClose={onClose} onUpdate={vi.fn()} onDelete={vi.fn()} />,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Termin löschen' }));
		await screen.findByRole('dialog', { name: 'Termin löschen?' });
		fireEvent.keyDown(document, { key: 'Escape' });

		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole('dialog', { name: 'Termin löschen?' })).toBeInTheDocument();
	});
});

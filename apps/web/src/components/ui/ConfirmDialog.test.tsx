import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

// jsdom doesn't implement <dialog> showModal()/close() — stub them so the
// component's imperative calls don't throw in this test environment.
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

function Harness() {
	const [tick, setTick] = useState(0);
	return (
		<>
			<button type="button" onClick={() => setTick((t) => t + 1)}>
				rerender {tick}
			</button>
			{/* Inline onClose on purpose — mirrors real call sites (e.g.
			    abos/page.tsx) and recreates a fresh closure on every render. */}
			<ConfirmDialog
				open
				onClose={() => undefined}
				onConfirm={() => undefined}
				title="Löschen?"
				description="Wirklich löschen?"
			/>
		</>
	);
}

describe('ConfirmDialog', () => {
	it('does not steal focus back to Cancel when the parent re-renders while open', async () => {
		render(<Harness />);

		const cancelButton = await screen.findByRole('button', { name: 'Abbrechen' });
		await waitFor(() => expect(cancelButton).toHaveFocus());

		const confirmButton = screen.getByRole('button', { name: 'Bestätigen' });
		act(() => confirmButton.focus());
		expect(confirmButton).toHaveFocus();

		// Simulate a background re-render of the parent (e.g. a poll interval)
		// while the dialog stays open — this recreates the inline `onClose`
		// closure passed to ConfirmDialog. Flush one animation frame so a
		// buggy re-run of the open-effect's requestAnimationFrame(focus) call
		// actually executes before we assert.
		await act(async () => {
			screen.getByText(/rerender/).click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
		});

		expect(confirmButton).toHaveFocus();
	});
});

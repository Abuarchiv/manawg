import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useModalDialog } from './useModalDialog';

beforeAll(() => {
	// jsdom implements neither showModal nor close on <dialog>.
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
		this.open = false;
	};
	globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	}) as typeof globalThis.requestAnimationFrame;
});

function Probe({ onClose }: { onClose: () => void }) {
	const [open, setOpen] = useState(true);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useModalDialog({ open, onClose, initialFocusRef: cancelRef });

	return (
		<div>
			<dialog ref={dialogRef} data-testid="dialog">
				<button ref={cancelRef} type="button">
					Abbrechen
				</button>
			</dialog>
			<button type="button" onClick={() => setOpen(false)}>
				Zuklappen
			</button>
		</div>
	);
}

describe('useModalDialog', () => {
	it('opens the dialog and focuses the safe action', () => {
		render(<Probe onClose={vi.fn()} />);

		expect(screen.getByTestId('dialog')).toHaveProperty('open', true);
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
	});

	it('routes the browser cancel event through onClose instead of closing directly', () => {
		const onClose = vi.fn();
		render(<Probe onClose={onClose} />);

		fireEvent(screen.getByTestId('dialog'), new Event('cancel', { cancelable: true }));

		expect(onClose).toHaveBeenCalledTimes(1);
		// Still open: closing is the caller's decision, made via onClose.
		expect(screen.getByTestId('dialog')).toHaveProperty('open', true);
	});

	it('closes the dialog when it stops being open', () => {
		render(<Probe onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Zuklappen' }));

		expect(screen.getByTestId('dialog')).toHaveProperty('open', false);
	});
});

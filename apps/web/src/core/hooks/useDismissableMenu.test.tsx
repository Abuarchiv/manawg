import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useDismissableMenu } from './useDismissableMenu';

function TestMenu() {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useDismissableMenu({ open, onClose: () => setOpen(false), triggerRef, menuRef });

	return (
		<div>
			<button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
				Öffnen
			</button>
			{open && (
				<div ref={menuRef} role="menu">
					<button type="button">Menüpunkt</button>
				</div>
			)}
			<button type="button">Außerhalb</button>
		</div>
	);
}

describe('useDismissableMenu', () => {
	it('closes on Escape and refocuses the trigger', () => {
		render(<TestMenu />);
		fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
		expect(screen.getByRole('menu')).toBeInTheDocument();

		fireEvent.keyDown(document, { key: 'Escape' });

		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('closes on a pointerdown outside the trigger and menu', () => {
		render(<TestMenu />);
		fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }));

		fireEvent.mouseDown(screen.getByRole('button', { name: 'Außerhalb' }));

		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('stays open on a pointerdown inside the menu', () => {
		render(<TestMenu />);
		fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }));

		fireEvent.mouseDown(screen.getByRole('button', { name: 'Menüpunkt' }));

		expect(screen.getByRole('menu')).toBeInTheDocument();
	});
});

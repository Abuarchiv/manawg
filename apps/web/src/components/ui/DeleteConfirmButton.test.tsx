import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirmButton } from './DeleteConfirmButton';

describe('DeleteConfirmButton', () => {
	it('keeps the initial delete affordance visible on touch-sized screens', () => {
		render(
			<DeleteConfirmButton
				id="item-1"
				onConfirm={vi.fn()}
				pending={false}
				ariaLabel="Eintrag löschen"
				ariaLabelConfirm="Eintrag wirklich löschen"
			/>,
		);

		const button = screen.getByRole('button', { name: 'Eintrag löschen' });
		expect(button).not.toHaveClass('opacity-0');
		expect(button).toHaveClass('opacity-70');
	});

	it('requires a second click before confirming deletion', () => {
		const onConfirm = vi.fn();
		render(
			<DeleteConfirmButton
				id="item-1"
				onConfirm={onConfirm}
				pending={false}
				ariaLabel="Eintrag löschen"
				ariaLabelConfirm="Eintrag wirklich löschen"
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Eintrag löschen' }));
		expect(onConfirm).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Eintrag wirklich löschen' }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePendingSet } from './usePendingSet';

function PendingButton({ onStart }: { onStart: () => void }) {
	const { isPending, start } = usePendingSet();

	function handleClick(): void {
		if (isPending('action')) return;
		start('action');
		onStart();
	}

	return (
		<button type="button" onClick={handleClick}>
			Start
		</button>
	);
}

describe('usePendingSet', () => {
	it('reports a started action synchronously before React rerenders', () => {
		const onStart = vi.fn();
		render(<PendingButton onStart={onStart} />);

		const button = screen.getByRole('button', { name: 'Start' });
		fireEvent.click(button);
		fireEvent.click(button);

		expect(onStart).toHaveBeenCalledTimes(1);
	});
});

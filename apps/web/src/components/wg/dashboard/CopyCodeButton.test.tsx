import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyCodeButton } from './CopyCodeButton';

describe('CopyCodeButton', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('copies a guided join link instead of the internal WG route', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: undefined,
		});

		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Code MTE8PZAT teilen' }));

		expect(await screen.findByRole('button', { name: 'WG geteilt' })).toBeVisible();
		expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/neu?code=MTE8PZAT'));
		expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('/wg/MTE8PZAT'));
	});

	it('uses the manual copy fallback when clipboard copy is blocked', async () => {
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

		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Code MTE8PZAT teilen' }));

		expect(await screen.findByRole('button', { name: 'WG geteilt' })).toBeVisible();
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('shows failed state when all copy methods are blocked', async () => {
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
			value: undefined,
		});

		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Code MTE8PZAT teilen' }));

		expect(await screen.findByRole('button', { name: 'Teilen fehlgeschlagen' })).toBeVisible();
	});

	it('keeps the latest share feedback visible after repeated clicks', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: undefined,
		});

		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Code MTE8PZAT teilen' }));
		await act(async () => undefined);
		expect(screen.getByRole('button', { name: 'WG geteilt' })).toBeVisible();
		act(() => vi.advanceTimersByTime(1000));

		fireEvent.click(screen.getByRole('button', { name: 'WG geteilt' }));
		await act(async () => undefined);
		expect(screen.getByRole('button', { name: 'WG geteilt' })).toBeVisible();
		act(() => vi.advanceTimersByTime(600));

		expect(screen.getByRole('button', { name: 'WG geteilt' })).toBeVisible();
		expect(writeText).toHaveBeenCalledTimes(2);
	});

	it('does not start duplicate shares while one share action is pending', async () => {
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
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: undefined,
		});

		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" />);

		const button = screen.getByRole('button', { name: 'WG-Code MTE8PZAT teilen' });
		fireEvent.click(button);
		fireEvent.click(button);

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'WG wird geteilt…' })).toBeDisabled();

		await act(async () => {
			finishCopy?.();
		});

		expect(await screen.findByRole('button', { name: 'WG geteilt' })).toBeVisible();
	});

	it('does not share while new joins are disabled', () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});

		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" joiningEnabled={false} />);

		const button = screen.getByRole('button', { name: 'Neue Beitritte sind gesperrt' });
		expect(button).toBeDisabled();
		expect(button).toHaveTextContent('Gesperrt');
		fireEvent.click(button);
		expect(writeText).not.toHaveBeenCalled();
	});

	it('renders the share action as a touch-sized control', () => {
		render(<CopyCodeButton code="MTE8PZAT" wgName="Test WG" />);

		expect(screen.getByRole('button', { name: 'WG-Code MTE8PZAT teilen' })).toHaveClass('min-h-11');
	});
});

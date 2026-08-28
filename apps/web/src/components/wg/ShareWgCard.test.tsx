import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareWgCard } from './ShareWgCard';

vi.mock('react-qr-code', () => ({
	default: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

describe('ShareWgCard', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('falls back to copying the invite link when native share fails', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: vi.fn().mockRejectedValue(new Error('not allowed')),
		});

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Einladung teilen' }));

		expect(await screen.findByRole('button', { name: 'Link kopiert' })).toBeVisible();
		expect(writeText).toHaveBeenCalledWith('https://mana.test/neu?code=MTE8PZAT');
	});

	it('uses the guided join flow in the QR invite link', () => {
		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		expect(screen.getByTestId('qr-code')).toHaveTextContent('https://mana.test/neu?code=MTE8PZAT');
	});

	it('renders the native share action as a touch-sized control', () => {
		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		expect(screen.getByRole('button', { name: 'WG-Einladung teilen' })).toHaveClass('h-11');
	});

	it('renders copy actions as touch-sized controls', () => {
		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		expect(screen.getByRole('button', { name: 'WG-Code kopieren' })).toHaveClass('min-h-11');
		expect(screen.getByRole('button', { name: 'Einladungslink kopieren' })).toHaveClass('min-h-11');
	});

	it('shows feedback when clipboard copy fails', async () => {
		const execCommand = vi.fn().mockReturnValue(false);
		Object.defineProperty(document, 'execCommand', {
			configurable: true,
			value: execCommand,
		});
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: vi.fn().mockRejectedValue(new Error('blocked')),
			},
		});

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Code kopieren' }));

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Kopieren fehlgeschlagen. Markiere den Code und kopiere ihn manuell.',
		);
	});

	it('uses a manual copy fallback when clipboard is blocked', async () => {
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, 'execCommand', {
			configurable: true,
			value: execCommand,
		});
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: vi.fn().mockRejectedValue(new Error('blocked')),
			},
		});

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		fireEvent.click(screen.getByRole('button', { name: 'Einladungslink kopieren' }));

		expect(await screen.findByRole('button', { name: 'Link kopiert' })).toBeVisible();
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('keeps the latest copy feedback visible when copy actions happen quickly', async () => {
		vi.useFakeTimers();
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockResolvedValue(undefined) },
		});

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Code kopieren' }));
		await act(async () => undefined);
		expect(screen.getByRole('button', { name: 'Code kopiert' })).toBeVisible();
		act(() => vi.advanceTimersByTime(1000));

		fireEvent.click(screen.getByRole('button', { name: 'Einladungslink kopieren' }));
		await act(async () => undefined);
		expect(screen.getByRole('button', { name: 'Link kopiert' })).toBeVisible();
		act(() => vi.advanceTimersByTime(600));

		expect(screen.getByRole('button', { name: 'Link kopiert' })).toBeVisible();
	});

	it('does not start duplicate copy actions while copying is pending', async () => {
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

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		const codeButton = screen.getByRole('button', { name: 'WG-Code kopieren' });
		fireEvent.click(codeButton);
		fireEvent.click(codeButton);

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'WG-Code wird kopiert…' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Einladungslink kopieren' })).toBeDisabled();

		await act(async () => {
			finishCopy?.();
		});

		expect(await screen.findByRole('button', { name: 'Code kopiert' })).toBeVisible();
	});

	it('does not start duplicate native shares while sharing is pending', async () => {
		let finishShare: (() => void) | undefined;
		const share = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishShare = resolve;
				}),
		);
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: share,
		});

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		const shareButton = screen.getByRole('button', { name: 'WG-Einladung teilen' });
		fireEvent.click(shareButton);
		fireEvent.click(shareButton);

		expect(share).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'WG-Einladung wird geteilt…' })).toBeDisabled();

		await act(async () => {
			finishShare?.();
		});

		expect(screen.getByRole('button', { name: 'WG-Einladung teilen' })).toBeVisible();
	});

	it('announces successful native share feedback', async () => {
		const share = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: share,
		});

		render(<ShareWgCard wgName="Test WG" shareCode="MTE8PZAT" appUrl="https://mana.test" />);

		fireEvent.click(screen.getByRole('button', { name: 'WG-Einladung teilen' }));

		expect(await screen.findByRole('status')).toHaveTextContent('Einladungslink bereit.');
		expect(share).toHaveBeenCalledWith({
			title: 'WG Test WG beitreten',
			text: 'Tritt der WG "Test WG" auf ManaWG bei. Code: MTE8PZAT',
			url: 'https://mana.test/neu?code=MTE8PZAT',
		});
	});

	it('prevents sharing when new joins are disabled', () => {
		render(
			<ShareWgCard
				wgName="Test WG"
				shareCode="MTE8PZAT"
				appUrl="https://mana.test"
				joiningEnabled={false}
			/>,
		);

		expect(screen.getByRole('status')).toHaveTextContent('Neue Beitritte sind gerade gesperrt.');
		expect(screen.getByRole('button', { name: 'WG-Code kopieren' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Einladungslink kopieren' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'WG-Einladung teilen' })).toBeDisabled();
	});
});

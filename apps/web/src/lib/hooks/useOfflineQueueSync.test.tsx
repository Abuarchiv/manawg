import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueueSync } from './useOfflineQueueSync';

const offlineMock = vi.hoisted(() => ({
	countOfflineActions: vi.fn(),
	syncOfflineActions: vi.fn(),
}));

vi.mock('@/lib/wg/offline-client', () => ({
	countOfflineActions: (...args: unknown[]) => offlineMock.countOfflineActions(...args),
	syncOfflineActions: (...args: unknown[]) => offlineMock.syncOfflineActions(...args),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/observability', () => ({
	captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

function Probe({ onSynced }: { onSynced: () => void }) {
	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: 'MTE8PZAT',
		memberId: 'member-1',
		page: 'test',
		onSynced,
	});
	return (
		<div>
			<span data-testid="queued">{queuedCount}</span>
			<button type="button" onClick={refreshCount}>
				Neu zählen
			</button>
		</div>
	);
}

describe('useOfflineQueueSync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		offlineMock.countOfflineActions.mockReturnValue(0);
		offlineMock.syncOfflineActions.mockResolvedValue(0);
	});

	it('reports the queued count on mount', () => {
		offlineMock.countOfflineActions.mockReturnValue(3);
		render(<Probe onSynced={vi.fn()} />);
		expect(screen.getByTestId('queued')).toHaveTextContent('3');
	});

	it('re-reads the count when the page enqueued something itself', () => {
		render(<Probe onSynced={vi.fn()} />);
		offlineMock.countOfflineActions.mockReturnValue(1);

		act(() => {
			screen.getByRole('button', { name: 'Neu zählen' }).click();
		});

		expect(screen.getByTestId('queued')).toHaveTextContent('1');
	});

	it('refreshes the count when the queue changes', () => {
		render(<Probe onSynced={vi.fn()} />);
		offlineMock.countOfflineActions.mockReturnValue(5);

		act(() => {
			window.dispatchEvent(new Event('manawg:offline-queue'));
		});

		expect(screen.getByTestId('queued')).toHaveTextContent('5');
	});

	it('flushes the queue and reloads when coming back online with pending actions', async () => {
		offlineMock.syncOfflineActions.mockResolvedValue(2);
		const onSynced = vi.fn();
		render(<Probe onSynced={onSynced} />);

		await act(async () => {
			window.dispatchEvent(new Event('online'));
		});

		expect(offlineMock.syncOfflineActions).toHaveBeenCalledWith('MTE8PZAT', {
			memberId: 'member-1',
		});
		expect(onSynced).toHaveBeenCalledTimes(1);
	});

	it('does not reload when the queue was already empty', async () => {
		const onSynced = vi.fn();
		render(<Probe onSynced={onSynced} />);

		await act(async () => {
			window.dispatchEvent(new Event('online'));
		});

		expect(onSynced).not.toHaveBeenCalled();
	});

	it('does not reload after the page unmounted mid-sync', async () => {
		let resolveSync: (value: number) => void = () => {};
		offlineMock.syncOfflineActions.mockReturnValue(
			new Promise<number>((resolve) => {
				resolveSync = resolve;
			}),
		);
		const onSynced = vi.fn();
		const { unmount } = render(<Probe onSynced={onSynced} />);

		act(() => {
			window.dispatchEvent(new Event('online'));
		});
		unmount();
		await act(async () => {
			resolveSync(2);
		});

		expect(onSynced).not.toHaveBeenCalled();
	});

	it('reports a failed sync instead of throwing', async () => {
		const failure = new Error('offline storage blocked');
		offlineMock.syncOfflineActions.mockRejectedValue(failure);
		render(<Probe onSynced={vi.fn()} />);

		await act(async () => {
			window.dispatchEvent(new Event('online'));
		});

		expect(captureExceptionMock).toHaveBeenCalledWith(failure, {
			action: 'syncOfflineActions',
			page: 'test',
		});
	});
});

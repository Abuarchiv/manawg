import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfflineQueueSync } from './useOfflineQueueSync';

const offlineMock = vi.hoisted(() => ({
	countOfflineActions: vi.fn(),
	syncOfflineActions: vi.fn(),
}));

vi.mock('@/core/offline/offline-client', async (importOriginal) => {
	// `getSyncedCountForWg` is pure (just reads `event.detail`) — keep the real
	// implementation so these tests exercise the same parsing the hook does in
	// production, instead of a hand-rolled copy that could silently drift.
	const actual = await importOriginal<typeof import('./offline-client')>();
	return {
		...actual,
		countOfflineActions: (...args: unknown[]) => offlineMock.countOfflineActions(...args),
		syncOfflineActions: (...args: unknown[]) => offlineMock.syncOfflineActions(...args),
	};
});

const captureExceptionMock = vi.hoisted(() => vi.fn());
vi.mock('@/core/infra/observability', () => ({
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

	it('flushes the queue when coming back online, and reloads once the real sync dispatches its event', async () => {
		// The real `syncOfflineActions` reports success by dispatching
		// `manawg:offline-synced` on `window` (see offline-client.ts) — the mock
		// does the same here so this exercises the hook's actual listener
		// instead of a since-removed direct call on the sync promise.
		offlineMock.syncOfflineActions.mockImplementation(async () => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 2, syncedByShareCode: { MTE8PZAT: 2 } },
				}),
			);
			return 2;
		});
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

	it('reloads on a sync triggered elsewhere (e.g. the "Jetzt senden" button), not just its own online-triggered sync', () => {
		// OfflineBanner's manual retry calls `syncOfflineActions` directly,
		// bypassing this hook's own `sync()` entirely — the only thing that
		// reaches this hook is the `manawg:offline-synced` event the shared
		// function dispatches. Without listening for it, a manual retry would
		// leave this page showing pre-sync data.
		const onSynced = vi.fn();
		render(<Probe onSynced={onSynced} />);

		act(() => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { MTE8PZAT: 1 } },
				}),
			);
		});

		expect(onSynced).toHaveBeenCalledTimes(1);
	});

	it('ignores a sync event for a different WG', () => {
		const onSynced = vi.fn();
		render(<Probe onSynced={onSynced} />);

		act(() => {
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 1, syncedByShareCode: { 'OTHER-WG': 1 } },
				}),
			);
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
			window.dispatchEvent(
				new CustomEvent('manawg:offline-synced', {
					detail: { synced: 2, syncedByShareCode: { MTE8PZAT: 2 } },
				}),
			);
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

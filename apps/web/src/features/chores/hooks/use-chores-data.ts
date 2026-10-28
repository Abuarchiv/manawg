import { useCallback, useRef } from 'react';
import { wgLoadError } from '@/core/guards/load-errors';
import { isNetworkError } from '@/core/http/error-codes';
import { type SyncedReloadReason, useSyncedCollection } from '@/core/sync/use-synced-collection';
import type { AbsenceInput } from '@/features/chores/absence';
import type {
	AbsenceListResponse,
	Chore,
	ChoreListResponse,
} from '@/features/chores/components/chore-types';
import { useMessage } from '@/shared/i18n/message';

interface ChoresDataParams {
	wg: { shareCode: string };
	identity: { memberId: string };
	encodedShareCode: string;
	setActionNotice: (message: string | null) => void;
}

const NO_COMPLETIONS: Record<string, number> = {};

/**
 * The chore plan and the absences, synced together: one load, poll and offline replay refreshes
 * both, because queued absences change the rotation the plan shows.
 */
export function useChoresData({
	wg,
	identity,
	encodedShareCode,
	setActionNotice,
}: ChoresDataParams) {
	const render = useMessage();
	const loadAllRef = useRef<(silent: boolean) => Promise<void>>(async () => undefined);
	const reload = (reason: SyncedReloadReason) => void loadAllRef.current(reason !== 'mount');
	// Offline with either list cached: keep showing the plan instead of an error state.
	const hasPageCache = (): boolean => chores.hasData() || absences.hasData();
	const hideOfflineError = (error: { status: number; error: string }): boolean =>
		hasPageCache() && isNetworkError(error.error, error.status);

	const chores = useSyncedCollection<ChoreListResponse, Chore>({
		url: `/api/wg/${encodedShareCode}/chores`,
		memberId: identity.memberId,
		select: (data) => data.chores,
		assemble: (items, current) => ({ ...current, chores: items }),
		getId: (chore) => chore.id,
		describeError: (error) =>
			render(wgLoadError({ key: 'chores.load.plan' }, error.status, error.error)),
		hideError: hideOfflineError,
		reload,
		offline: {
			shareCode: wg.shareCode,
			page: 'putzen',
			onReplayed: () => setActionNotice(null),
		},
	});
	const absences = useSyncedCollection<AbsenceListResponse, AbsenceInput>({
		url: `/api/wg/${encodedShareCode}/absences`,
		memberId: identity.memberId,
		select: (data) => data.absences,
		assemble: (items, current) => ({ ...current, absences: items }),
		getId: (absence) => absence.id,
		describeError: (error) =>
			render(wgLoadError({ key: 'chores.load.absences' }, error.status, error.error)),
		hideError: hideOfflineError,
		// The plan's mount load, poll and replay reload both lists.
		pollIntervalMs: null,
		reload: (reason) => {
			if (reason !== 'mount') reload(reason);
		},
	});

	const loadChores = chores.load;
	const loadAbsences = absences.load;
	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			await Promise.all([loadChores({ silent: !initial }), loadAbsences({ silent: !initial })]);
		},
		[loadAbsences, loadChores],
	);
	loadAllRef.current = (silent) => load(!silent);

	return {
		items: chores.items,
		monthCompletions: chores.data?.monthCompletions ?? NO_COMPLETIONS,
		absences: absences.items,
		// Only the chore list decides: an early absences answer must not show the empty state.
		initialLoading: chores.initialLoading && chores.data === undefined,
		refreshing: chores.refreshing || absences.refreshing,
		loadError: chores.loadError ?? absences.loadError,
		load,
		updateChores: chores.commit,
		updateAbsences: absences.commit,
		queuedCount: chores.queuedCount,
		refreshCount: chores.refreshCount,
	};
}

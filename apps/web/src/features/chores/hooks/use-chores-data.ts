import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { isNetworkError } from '@/core/http/error-codes';
import { captureException } from '@/core/infra/observability';
import { syncOfflineActions } from '@/core/offline/offline-client';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import type { AbsenceInput } from '@/features/chores/absence';
import type {
	AbsenceListResponse,
	Chore,
	ChoreListResponse,
} from '@/features/chores/components/chore-types';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ChoresDataParams {
	wg: { shareCode: string };
	identity: { memberId: string };
	encodedShareCode: string;
	setActionNotice: (message: string | null) => void;
}

/** Putzplan und Abwesenheiten: Cache-Start, Laden, 30-s-Refresh und Offline-Sync. */
export function useChoresData({
	wg,
	identity,
	encodedShareCode,
	setActionNotice,
}: ChoresDataParams) {
	const {
		data: cachedChores,
		error: choresReadError,
		refresh: refreshChores,
		setData: setCachedChores,
	} = useCachedFetch<ChoreListResponse>(`/api/wg/${encodedShareCode}/chores`, {
		memberId: identity.memberId,
	});
	const {
		data: cachedAbsences,
		error: absencesReadError,
		refresh: refreshAbsences,
		setData: setCachedAbsences,
	} = useCachedFetch<AbsenceListResponse>(`/api/wg/${encodedShareCode}/absences`, {
		memberId: identity.memberId,
	});
	const [items, setItems] = useState<Chore[]>(() => cachedChores?.chores ?? []);
	const [monthCompletions, setMonthCompletions] = useState<Record<string, number>>(
		() => cachedChores?.monthCompletions ?? {},
	);
	const absences = cachedAbsences?.absences ?? [];
	const [initialLoading, setInitialLoading] = useState(!cachedChores && !cachedAbsences);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const hasPageCacheRef = useRef(Boolean(cachedChores || cachedAbsences));
	const mountedRef = useRef(false);
	const loadRequestIdRef = useRef(0);
	const initialLoadStartedRef = useRef(false);

	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			const requestId = loadRequestIdRef.current + 1;
			loadRequestIdRef.current = requestId;
			if (initial && !hasPageCacheRef.current) {
				setInitialLoading(true);
			} else {
				setRefreshing(true);
			}
			const [result, absenceResult] = await Promise.all([refreshChores(), refreshAbsences()]);
			if (requestId !== loadRequestIdRef.current) {
				return;
			}
			let nextLoadError: string | null = null;
			if (result.ok) {
				setItems(result.data.chores);
				setMonthCompletions(result.data.monthCompletions ?? {});
				syncOfflineActions(wg.shareCode, { memberId: identity.memberId })
					.then((synced) => {
						if (!mountedRef.current) return;
						if (requestId !== loadRequestIdRef.current) return;
						refreshCount();
						if (synced > 0) {
							setActionNotice(null);
							void load(false);
						}
					})
					.catch((err) => captureException(err, { action: 'syncOfflineActions', page: 'putzen' }));
			} else if (!(hasPageCacheRef.current && isNetworkError(result.error, result.status))) {
				// Offline mit vorhandenem Cache: Liste weiter zeigen, kein Fehlerzustand.
				nextLoadError = getWgLoadErrorMessage('Putzplan', result.status, result.error);
			}
			if (
				!absenceResult.ok &&
				!nextLoadError &&
				!(hasPageCacheRef.current && isNetworkError(absenceResult.error, absenceResult.status))
			) {
				nextLoadError = getWgLoadErrorMessage(
					'Abwesenheiten',
					absenceResult.status,
					absenceResult.error,
					{ verb: 'konnten' },
				);
			}
			setLoadError(nextLoadError);
			if (requestId === loadRequestIdRef.current) {
				setInitialLoading(false);
				setRefreshing(false);
			}
		},
		[identity.memberId, refreshAbsences, refreshChores, setActionNotice, wg.shareCode],
	);
	useEffect(() => {
		if (cachedChores) {
			hasPageCacheRef.current = true;
			setItems(cachedChores.chores);
			setMonthCompletions(cachedChores.monthCompletions ?? {});
		}
	}, [cachedChores]);
	useEffect(() => {
		if (cachedChores || cachedAbsences) {
			hasPageCacheRef.current = true;
			setInitialLoading(false);
			setLoadError(null);
		}
		const hasCache = Boolean(cachedChores || cachedAbsences);
		if (
			choresReadError &&
			!(hasCache && isNetworkError(choresReadError.error, choresReadError.status))
		) {
			setLoadError(
				getWgLoadErrorMessage('Putzplan', choresReadError.status, choresReadError.error),
			);
		} else if (
			absencesReadError &&
			!(hasCache && isNetworkError(absencesReadError.error, absencesReadError.status))
		) {
			setLoadError(
				getWgLoadErrorMessage('Abwesenheiten', absencesReadError.status, absencesReadError.error, {
					verb: 'konnten',
				}),
			);
		}
	}, [absencesReadError, cachedAbsences, cachedChores, choresReadError]);

	function updateAbsences(update: (current: AbsenceInput[]) => AbsenceInput[]): void {
		setCachedAbsences((current) => ({
			...(current ?? { absences: [] }),
			absences: update(current?.absences ?? []),
		}));
	}

	function updateChores(update: (current: Chore[]) => Chore[]): void {
		setItems(update);
		setCachedChores((current) => {
			const previous = current?.chores ?? items;
			const next = update(previous);
			if (!current && next === previous) return current;
			return { ...(current ?? { chores: previous }), chores: next };
		});
	}

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;
		void load(true);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(false), 30_000);

	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		page: 'putzen',
		onSynced: () => void load(false),
	});

	return {
		items,
		setItems,
		monthCompletions,
		absences,
		initialLoading,
		refreshing,
		loadError,
		load,
		updateChores,
		updateAbsences,
		queuedCount,
		refreshCount,
	};
}

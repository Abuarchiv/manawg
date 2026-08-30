'use client';

import { ALERT_DANGER_ROW } from '@/components/ui/styles';
import { BackLink } from '@/components/wg/BackLink';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { apiFetch } from '@/core/infra/api-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { InventoryList } from '@/features/inventory/components/InventoryList';
import type { InventoryCategory, InventoryItemDto } from '@/features/inventory/inventory';
import { Loader2, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface InventoryResponse {
	items: InventoryItemDto[];
	grouped: Record<InventoryCategory, InventoryItemDto[]>;
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function VorraetePage() {
	const { wg, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const [items, setItems] = useState<InventoryItemDto[]>([]);
	const [initialLoading, setInitialLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const requestIdRef = useRef(0);

	const load = useCallback(
		async (silent = false): Promise<void> => {
			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			if (!silent) setInitialLoading(true);
			const res = await apiFetch<InventoryResponse>(`/api/wg/${encodedShareCode}/inventory`, {
				memberId: identity.memberId,
			});
			if (requestId !== requestIdRef.current) {
				if (!silent) setInitialLoading(false);
				return;
			}
			if (res.ok) {
				setLoadError(null);
				setItems(res.data.items);
			} else if (!silent) {
				setLoadError(getWgLoadErrorMessage('Vorräte', res.status, res.error));
			}
			if (!silent && requestId === requestIdRef.current) setInitialLoading(false);
		},
		[encodedShareCode, identity.memberId],
	);

	useEffect(() => {
		void load(false);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(true), 30_000);

	return (
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-center gap-3">
				<BackLink href={`/wg/${encodedShareCode}/einkauf`} label="Einkaufsliste" />
				<div className="min-w-0 flex-1">
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">Vorräte</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
						{items.length === 0
							? 'Noch keine Vorräte erfasst.'
							: `${items.length} Artikel im Bestand.`}
					</p>
				</div>
			</header>

			{loadError && (
				<div role="alert" className={ALERT_DANGER_ROW}>
					<span>{loadError}</span>
					<button
						type="button"
						onClick={() => void load(false)}
						disabled={initialLoading}
						className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<RotateCw
							className={`h-3.5 w-3.5 ${initialLoading ? 'animate-spin' : ''}`}
							aria-hidden
						/>
						{initialLoading ? 'Lädt...' : 'Erneut laden'}
					</button>
				</div>
			)}

			{initialLoading && items.length === 0 ? (
				<div
					className="flex h-32 items-center justify-center text-[var(--text-3)]"
					aria-busy="true"
				>
					<Loader2 className="h-5 w-5 animate-spin" aria-hidden />
					<span className="sr-only">Vorräte werden geladen</span>
				</div>
			) : (
				<InventoryList
					items={items}
					shareCode={wg.shareCode}
					memberId={identity.memberId}
					memberToken={identity.memberToken}
					onChanged={() => void load(true)}
				/>
			)}
		</div>
	);
}

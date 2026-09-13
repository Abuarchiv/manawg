'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemGroup } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { BackLink } from '@/components/wg/BackLink';
import { SubNav } from '@/components/wg/SubNav';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { apiFetch } from '@/core/infra/api-client';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { InventoryList } from '@/features/inventory/components/InventoryList';
import type { InventoryCategory, InventoryItemDto } from '@/features/inventory/inventory';
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
				return;
			}
			if (res.ok) {
				setLoadError(null);
				setItems(res.data.items);
			} else {
				setLoadError(getWgLoadErrorMessage('Vorräte', res.status, res.error));
			}
			setInitialLoading(false);
		},
		[encodedShareCode, identity.memberId],
	);

	useEffect(() => {
		void load(false);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(true), 30_000);

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
			<header className="flex items-center gap-3">
				<BackLink href={`/wg/${encodedShareCode}/einkauf`} label="Haushalt" />
				<div className="min-w-0 flex-1">
					<h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
						Vorräte
					</h1>
					<p className="mt-1" aria-live="polite" aria-atomic="true">
						{initialLoading && items.length === 0 ? (
							<span className="text-[13px] text-muted-foreground">Vorräte werden geladen…</span>
						) : loadError && items.length === 0 ? (
							<span className="text-[13px] text-muted-foreground">
								Vorräte derzeit nicht verfügbar.
							</span>
						) : items.length === 0 ? null : (
							<Badge variant="secondary" className="tabular-nums">
								{items.length} Artikel im Bestand
							</Badge>
						)}
					</p>
				</div>
			</header>
			<SubNav label="Haushalt" items={[]} />

			{loadError && (
				<Alert variant="destructive">
					<AlertTitle>Laden fehlgeschlagen</AlertTitle>
					<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
						<span>{loadError}</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void load(false)}
							disabled={initialLoading}
							className="min-h-11"
						>
							{initialLoading && <Spinner aria-hidden />}
							{initialLoading ? 'Lädt…' : 'Erneut laden'}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{initialLoading && items.length === 0 ? (
				<Card className="py-0">
					<CardContent className="p-0">
						<ItemGroup className="gap-0" aria-busy="true" aria-label="Vorräte werden geladen">
							{['s0', 's1', 's2'].map((k) => (
								<Item key={k} className="px-3 py-3">
									<ItemContent className="flex-1 gap-2">
										<Skeleton className="h-3.5 w-2/5" />
										<Skeleton className="h-3 w-3/5" />
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					</CardContent>
				</Card>
			) : loadError && items.length === 0 ? (
				<Empty className="border border-dashed">
					<EmptyHeader>
						<EmptyTitle>Vorräte noch nicht geladen</EmptyTitle>
						<EmptyDescription>
							Versuche es erneut, sobald die Verbindung wieder da ist.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<InventoryList
					items={items}
					shareCode={wg.shareCode}
					memberId={identity.memberId}
					memberToken={identity.memberToken}
					onChanged={() => void load(true)}
				/>
			)}
			<div aria-hidden className="h-[env(safe-area-inset-bottom,0px)]" />
		</div>
	);
}

'use client';

import { Button } from '@/components/ui/button';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { SubNav } from '@/components/wg/SubNav';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { useWg } from '@/components/wg/WgContextProvider';
import { InventoryList } from '@/features/inventory/components/InventoryList';
import { ListSkeleton } from '@/features/inventory/components/ListSkeleton';
import { useInventoryPage } from '@/features/inventory/hooks/use-inventory-page';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Delay before the deep-linked item is scrolled into view, so the list has laid out. */
const SCROLL_DELAY_MS = 80;
/** How long the ring stays around the item reached via link. */
const HIGHLIGHT_MS = 3000;

export default function VorraetePage() {
	const t = useTranslations('inventory.page');
	const tCommon = useTranslations('common');
	const { wg, identity } = useWg();
	const { items, initialLoading, loadError, addOpen, setAddOpen, load, onChanged } =
		useInventoryPage(wg.shareCode, identity.memberId);

	// Deep link from the notification (?highlight=<id>): scroll to the center once, show the ring briefly.
	const targetId = useSearchParams().get('highlight');
	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	const targetFound = targetId !== null && items.some((item) => item.id === targetId);
	useEffect(() => {
		if (!targetId || !targetFound) return;
		setHighlightedId(targetId);
		const scrollTimer = window.setTimeout(() => {
			document.getElementById(`inventory-${targetId}`)?.scrollIntoView({ block: 'center' });
		}, SCROLL_DELAY_MS);
		const clearTimer = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
		return () => {
			window.clearTimeout(scrollTimer);
			window.clearTimeout(clearTimer);
		};
	}, [targetId, targetFound]);

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 py-3">
			<SubNav />
			{/* The active tab already names the page; title and count stay for screen readers. */}
			<header className="sr-only">
				<h1 tabIndex={-1}>{t('title')}</h1>
				<p aria-live="polite" aria-atomic="true">
					{initialLoading && items.length === 0
						? tCommon('loading')
						: loadError && items.length === 0
							? t('unavailable')
							: items.length === 0
								? null
								: t('count', { count: items.length })}
				</p>
			</header>

			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void load(false)}
					busy={initialLoading}
					retryLabel={t('reload')}
				/>
			)}

			{initialLoading && items.length === 0 ? (
				<ListSkeleton />
			) : loadError && items.length === 0 ? null : (
				<InventoryList
					items={items}
					shareCode={wg.shareCode}
					memberId={identity.memberId}
					onChanged={onChanged}
					addOpen={addOpen}
					onAddOpenChange={setAddOpen}
					highlightedId={highlightedId}
				/>
			)}
			{!(initialLoading && items.length === 0) && !(loadError && items.length === 0) && (
				<ThumbAction>
					<Button type="button" className="min-h-11 w-full" onClick={() => setAddOpen(true)}>
						<Plus data-icon="inline-start" aria-hidden />
						{t('add')}
					</Button>
				</ThumbAction>
			)}
			<div aria-hidden className="h-[env(safe-area-inset-bottom,0px)]" />
		</div>
	);
}

'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import {
	type ActivityFilter,
	type ActivityItem,
	type ActivityKind,
	type ActivityReminder,
	buildActivityInbox,
	filterActivityItems,
	groupActivityItemsByDay,
} from '@/composition/activity';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { cn } from '@/shared/lib/cn';
import { History, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityFeed } from '../_components/ActivityFeed';

interface ActivityResponse {
	items: ActivityItem[];
	reminders: ActivityReminder[];
}

function formatVisibleActivityCount(count: number): string {
	if (count === 0) return 'Keine sichtbaren Einträge.';
	if (count === 1) return '1 Eintrag sichtbar.';
	return `${count} Einträge sichtbar.`;
}

export default function AktivitaetPage() {
	const { wg, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const {
		data: cachedActivity,
		error: activityError,
		isLoading: activityLoading,
		refresh: refreshActivity,
	} = useCachedFetch<ActivityResponse>(`/api/wg/${encodedShareCode}/activity`, {
		memberId: identity.memberId,
	});
	const [data, setData] = useState<ActivityResponse | null>(cachedActivity ?? null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(activityLoading);
	const [filter, setFilter] = useState<ActivityFilter>({ kind: 'all', mineOnly: false, query: '' });
	const requestIdRef = useRef(0);

	const load = useCallback(async (): Promise<void> => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setLoading(true);
		try {
			const res = await refreshActivity();
			if (requestId !== requestIdRef.current) return;
			if (res.ok) {
				setData(res.data);
				setError(null);
			} else {
				setError(getWgLoadErrorMessage('Aktivität', res.status, res.error));
			}
		} finally {
			if (requestId === requestIdRef.current) setLoading(false);
		}
	}, [refreshActivity]);

	useEffect(() => {
		void load();
	}, [load]);
	useVisibilityPausedInterval(() => void load(), 30_000);

	useEffect(() => {
		if (cachedActivity) {
			setData(cachedActivity);
			setError(null);
			setLoading(false);
		} else if (activityError) {
			setError(getWgLoadErrorMessage('Aktivität', activityError.status, activityError.error));
			setLoading(false);
		}
	}, [activityError, cachedActivity]);

	const filteredItems = useMemo(
		() => filterActivityItems(data?.items ?? [], filter, identity.name, identity.memberId),
		[data?.items, filter, identity.memberId, identity.name],
	);
	const chronicleGroups = useMemo(
		() =>
			groupActivityItemsByDay(
				filteredItems.map((item) =>
					item.href ? { ...item, href: `${wgBaseHref}${item.href}` } : item,
				),
			),
		[filteredItems, wgBaseHref],
	);
	const inboxItems = useMemo(
		() => (data ? buildActivityInbox({ reminders: data.reminders }) : []),
		[data],
	);

	function setKind(kind: ActivityKind | 'all'): void {
		setFilter((current) => ({ ...current, kind }));
	}

	const hasActiveFilter = filter.kind !== 'all' || filter.query.trim().length > 0;

	function resetFilters(): void {
		setFilter({ kind: 'all', mineOnly: false, query: '' });
		// Der Knopf verschwindet mit dem Leerzustand: Fokus auf den Bereichsfilter (öffnet keine Tastatur).
		document.getElementById('activity-kind')?.focus({ preventScroll: true });
	}

	return (
		<div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3">
			<h1 className="font-heading min-w-0 flex-1 text-base font-semibold tracking-tight break-words text-foreground">
				Aktivität
			</h1>

			{error && (
				<LoadErrorBanner
					message={error}
					onRetry={() => void load()}
					busy={loading}
					retryLabel="Aktivität erneut laden"
				/>
			)}

			{/* Filter stehen über der Inbox: sie verschwindet beim Suchen und würde das Feld sonst unter dem Finger wegschieben. */}
			{data && data.items.length > 0 && (
				<Card className="overflow-visible border-0 bg-transparent py-0 shadow-none">
					<CardContent className="space-y-3 p-0">
						<InputGroup>
							<InputGroupAddon align="inline-start">
								<Search className="h-4 w-4" aria-hidden />
							</InputGroupAddon>
							<InputGroupInput
								type="search"
								value={filter.query}
								onChange={(event) => {
									const query = event.currentTarget.value;
									setFilter((current) => ({ ...current, query }));
								}}
								placeholder="Aktivität durchsuchen"
								aria-label="Aktivität durchsuchen"
								className="min-h-11 text-base"
							/>
						</InputGroup>
						<div className="grid grid-cols-1 gap-2">
							<label htmlFor="activity-kind" className="grid min-w-0 gap-1 text-xs font-medium">
								Bereich
								<NativeSelect
									id="activity-kind"
									value={filter.kind}
									onChange={(event) => setKind(event.target.value as ActivityKind | 'all')}
									className="w-full"
								>
									<NativeSelectOption value="all">Alle</NativeSelectOption>
									<NativeSelectOption value="expense">Ausgaben</NativeSelectOption>
									<NativeSelectOption value="shopping">Einkäufe</NativeSelectOption>
									<NativeSelectOption value="announcement">Pinnwand</NativeSelectOption>
									<NativeSelectOption value="chore">Putzplan</NativeSelectOption>
									<NativeSelectOption value="recurring">Fixkosten</NativeSelectOption>
									<NativeSelectOption value="absence">Abwesenheiten</NativeSelectOption>
									<NativeSelectOption value="audit">WG-Änderungen</NativeSelectOption>
								</NativeSelect>
							</label>
						</div>
					</CardContent>
				</Card>
			)}

			{data && inboxItems.length > 0 && !hasActiveFilter && (
				<Card>
					<CardHeader>
						<div className="flex min-w-0 items-baseline justify-between gap-2">
							<CardTitle className="min-w-0">Offen</CardTitle>
							<span className="shrink-0 text-xs text-muted-foreground">{inboxItems.length}</span>
						</div>
					</CardHeader>
					<CardContent>
						<ItemGroup aria-label="Offene Klärungen">
							{inboxItems.map((item) => (
								<Item
									key={item.id}
									size="sm"
									className="rounded-none border-0 border-b border-border px-0 last:border-b-0"
									render={<Link href={`${wgBaseHref}${item.href}`} />}
								>
									<ItemContent className="min-w-0">
										<ItemTitle className="min-w-0 w-full">
											<span
												className={cn('line-clamp-1', item.priority === 'high' && 'font-semibold')}
											>
												{item.title}
											</span>
										</ItemTitle>
										<ItemDescription className="min-w-0 line-clamp-1">
											{item.detail}
										</ItemDescription>
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					</CardContent>
				</Card>
			)}

			<Card className="overflow-visible border-0 bg-transparent py-0 shadow-none">
				<CardContent className="p-0">
					{data ? (
						<div className="space-y-3">
							{/* Dauerhaft eingehängt, damit Screenreader jede Änderung der Trefferzahl ansagen. */}
							{data.items.length > 0 && (
								<output
									aria-live="polite"
									className={cn(
										'block text-[12px] text-muted-foreground',
										(!hasActiveFilter || chronicleGroups.length === 0) && 'sr-only',
									)}
								>
									{formatVisibleActivityCount(filteredItems.length)}
								</output>
							)}
							{chronicleGroups.length > 0 ? (
								chronicleGroups.map((group) => (
									<div key={group.date} className="space-y-2">
										<Marker variant="separator">
											<MarkerContent>
												<span className="font-medium">{group.label}</span>
											</MarkerContent>
										</Marker>
										<ActivityFeed items={group.items} />
									</div>
								))
							) : hasActiveFilter ? (
								<Empty className="border-0 py-5">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<Search aria-hidden />
										</EmptyMedia>
										<EmptyTitle>Keine Aktivität für diesen Filter</EmptyTitle>
									</EmptyHeader>
									<EmptyContent>
										<Button type="button" variant="outline" size="sm" onClick={resetFilters}>
											Filter zurücksetzen
										</Button>
									</EmptyContent>
								</Empty>
							) : (
								<Empty className="border-0 py-5">
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<History aria-hidden />
										</EmptyMedia>
										<EmptyTitle>Noch keine Aktivität</EmptyTitle>
										<EmptyDescription>
											Hier erscheint, was in der WG passiert: Ausgaben, Einkäufe, Putzplan.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							)}
						</div>
					) : loading ? (
						// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
						<div className="space-y-2" aria-label="Aktivität lädt" role="status">
							<div className="flex justify-center py-2">
								<Spinner className="motion-reduce:animate-none" aria-hidden />
							</div>
							{[0, 1, 2].map((index) => (
								<div key={index} className="flex items-start gap-3 py-2">
									<Skeleton className="size-8 shrink-0 rounded-full" />
									<div className="flex-1 space-y-2">
										<Skeleton className="h-4 w-3/4" />
										<Skeleton className="h-3 w-1/2" />
									</div>
								</div>
							))}
						</div>
					) : error ? null : (
						<p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
							Keine Aktivität geladen. Versuche es erneut.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

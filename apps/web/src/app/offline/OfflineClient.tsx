'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { readOfflineQueue, syncOfflineActions } from '@/core/offline/offline-client';
import {
	formatManualOfflineSyncResult,
	getOfflineSyncFailureMessage,
} from '@/core/offline/offline-copy';
import {
	type OfflineAction,
	getOfflineActionRisk,
	getOfflineActionSummary,
} from '@/core/offline/offline-queue';
import { parseTimestamp } from '@/core/utils/time';
import { type KnownWg, getKnownWgs } from '@/shared/lib/identity';
import { ArrowRight, CheckCircle2, CloudOff, RefreshCw, RotateCw, Wifi } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function moduleLabel(action: OfflineAction): string {
	return getOfflineActionSummary(action).title;
}

export function formatOfflineAge(iso: string, now = Date.now()): string {
	const timestamp = parseTimestamp(iso);
	if (timestamp === null) return 'Zeitpunkt unklar';
	const ageMs = now - timestamp;
	if (ageMs < 0) return 'Zeitpunkt in der Zukunft';
	if (ageMs < 60_000) return 'gerade eben';
	const minutes = Math.floor(ageMs / 60_000);
	if (minutes < 60) return `vor ${minutes} Min.`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `vor ${hours} Std.`;
	return `vor ${Math.floor(hours / 24)} Tagen`;
}

function countByShareCode(items: OfflineAction[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.shareCode, (counts.get(item.shareCode) ?? 0) + 1);
	return counts;
}

function formatQueuedActionCount(count: number): string {
	if (count === 0) return 'Keine wartenden Aktionen.';
	if (count === 1) return '1 Aktion wartet.';
	return `${count} Aktionen warten.`;
}

function formatWgQueuedActionCount(count: number): string {
	if (count === 0) return 'Keine wartenden Aktionen';
	if (count === 1) return '1 Aktion wartet';
	return `${count} Aktionen warten`;
}

function wgHref(code: string, suffix = ''): string {
	return `/wg/${encodeURIComponent(code)}${suffix}`;
}

type AccountMembership = { code: string; memberId: string };

async function getAccountMemberships(): Promise<AccountMembership[] | null> {
	const res = await fetch('/api/wg/mine', { cache: 'no-store' });
	if (res.status === 401) return null;
	if (!res.ok) throw new Error('account_wgs_failed');
	const data: unknown = await res.json();
	if (!data || typeof data !== 'object' || !Array.isArray((data as { wgs?: unknown }).wgs)) {
		throw new Error('account_wgs_invalid');
	}
	return (data as { wgs: unknown[] }).wgs.filter(
		(wg): wg is AccountMembership =>
			typeof wg === 'object' &&
			wg !== null &&
			typeof (wg as AccountMembership).code === 'string' &&
			typeof (wg as AccountMembership).memberId === 'string',
	);
}

export function OfflineClient() {
	const [online, setOnline] = useState(true);
	const [knownWgs, setKnownWgs] = useState<KnownWg[]>([]);
	const [queue, setQueue] = useState<OfflineAction[]>([]);
	const [syncing, setSyncing] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const syncingRef = useRef(false);

	const refresh = useCallback(async (): Promise<OfflineAction[]> => {
		setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
		setKnownWgs([]);
		setQueue([]);
		setMessage(null);
		try {
			const memberships = await getAccountMemberships();
			if (!memberships) return [];
			const memberKeys = new Set(memberships.map(({ code, memberId }) => `${code}:${memberId}`));
			const memberCodes = new Set(memberships.map(({ code }) => code));
			const nextQueue = readOfflineQueue().filter((action) =>
				memberKeys.has(`${action.shareCode}:${action.memberId}`),
			);
			setKnownWgs(getKnownWgs().filter((wg) => memberCodes.has(wg.code)));
			setQueue(nextQueue);
			return nextQueue;
		} catch {
			return [];
		}
	}, []);

	useEffect(() => {
		void refresh();
		const refreshOnEvent = () => void refresh();
		window.addEventListener('online', refreshOnEvent);
		window.addEventListener('offline', refreshOnEvent);
		window.addEventListener('manawg:offline-queue', refreshOnEvent);
		return () => {
			window.removeEventListener('online', refreshOnEvent);
			window.removeEventListener('offline', refreshOnEvent);
			window.removeEventListener('manawg:offline-queue', refreshOnEvent);
		};
	}, [refresh]);

	const queueCounts = useMemo(() => countByShareCode(queue), [queue]);
	const recentQueue = queue.slice(0, 4);
	const hiddenQueueCount = Math.max(0, queue.length - recentQueue.length);
	const primaryWg =
		knownWgs.find((wg) => (queueCounts.get(wg.code) ?? 0) > 0) ?? knownWgs[0] ?? null;

	async function syncNow() {
		if (syncingRef.current || queue.length === 0) return;
		syncingRef.current = true;
		setSyncing(true);
		setMessage(null);
		try {
			const memberships = await getAccountMemberships();
			if (!memberships) {
				setMessage('Melde dich an, bevor du Offline-Aktionen synchronisierst.');
				return;
			}
			const queuedMemberships = memberships.filter(({ code, memberId }) =>
				queue.some((action) => action.shareCode === code && action.memberId === memberId),
			);
			if (queuedMemberships.length === 0) {
				setMessage('Für diese Aktionen fehlt die passende Konto-WG. Sie bleiben gespeichert.');
				return;
			}
			let synced = 0;
			for (const { code, memberId } of queuedMemberships) {
				synced += await syncOfflineActions(code, { force: true, memberId });
			}
			const nextQueue = await refresh();
			setMessage(formatManualOfflineSyncResult(synced, nextQueue.length, { offlineLabel: false }));
		} catch {
			await refresh();
			setMessage(getOfflineSyncFailureMessage());
		} finally {
			syncingRef.current = false;
			setSyncing(false);
		}
	}

	return (
		<main
			id="main"
			tabIndex={-1}
			className="min-h-svh bg-background px-4 py-6 text-foreground focus:outline-none"
		>
			<div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col justify-center gap-4 pb-[env(safe-area-inset-bottom)]">
				<Card>
					<CardHeader>
						<div className="flex items-start gap-3">
							<span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
								{online ? (
									<Wifi className="h-5 w-5 text-primary" aria-hidden />
								) : (
									<CloudOff className="h-5 w-5 text-muted-foreground" aria-hidden />
								)}
							</span>
							<div className="min-w-0 flex-1">
								<Badge variant={online ? 'secondary' : 'outline'}>
									{online ? 'Wieder online' : 'Offline-Modus'}
								</Badge>
								<CardTitle className="mt-2 text-xl" aria-live="polite">
									{online ? 'Du bist wieder verbunden.' : 'Du bist gerade offline.'}
								</CardTitle>
								<CardDescription className="mt-1">
									ManaWG speichert vorbereitete Aktionen auf diesem Gerät. Sobald das Netz zurück
									ist, kannst du sie synchronisieren und in deine WG zurückspringen.
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="grid grid-cols-1 gap-2">
						<Button
							type="button"
							onClick={syncNow}
							disabled={syncing || queue.length === 0}
							aria-label={
								syncing
									? 'Offline-Aktionen werden synchronisiert'
									: 'Offline-Aktionen jetzt synchronisieren'
							}
							size="lg"
							className="min-h-11 w-full"
						>
							{syncing ? (
								<Spinner className="motion-reduce:animate-none" aria-hidden />
							) : (
								<RefreshCw data-icon="inline-start" aria-hidden />
							)}
							Jetzt synchronisieren
						</Button>
						<Button
							type="button"
							variant="outline"
							size="lg"
							onClick={() => void refresh()}
							aria-label="Offline-Status erneut prüfen"
							className="min-h-11 w-full"
						>
							<RotateCw data-icon="inline-start" aria-hidden />
							Prüfen
						</Button>
					</CardContent>
					{message && (
						<CardContent>
							<Alert>
								<AlertTitle>Synchronisation</AlertTitle>
								<AlertDescription>
									<output aria-live="polite">{message}</output>
								</AlertDescription>
							</Alert>
						</CardContent>
					)}
				</Card>

				<Card>
					<CardHeader>
						<div className="flex items-center justify-between gap-3">
							<div>
								<CardTitle className="text-base">Warteschlange</CardTitle>
								<CardDescription>{formatQueuedActionCount(queue.length)}</CardDescription>
							</div>
							{queue.length === 0 && <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden />}
						</div>
					</CardHeader>
					<CardContent>
						{recentQueue.length > 0 ? (
							<ItemGroup aria-label="Wartende Offline-Aktionen">
								{recentQueue.map((item) => {
									const summary = getOfflineActionSummary(item);
									const risk = getOfflineActionRisk(item);
									return (
										<Item key={item.id} variant="outline">
											<ItemContent>
												<ItemTitle>{summary.title}</ItemTitle>
												<ItemDescription className="truncate">{summary.detail}</ItemDescription>
												{item.lastError && (
													<p className="mt-1 text-xs text-destructive">{item.lastError}</p>
												)}
												{risk && (
													<p className="mt-1 text-xs text-muted-foreground">
														{risk.title}: {risk.detail}
													</p>
												)}
											</ItemContent>
											<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
												{formatOfflineAge(item.createdAt)}
											</span>
										</Item>
									);
								})}
							</ItemGroup>
						) : (
							<Empty>
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<CheckCircle2 aria-hidden />
									</EmptyMedia>
									<EmptyTitle>Keine wartenden Aktionen.</EmptyTitle>
									<EmptyDescription>
										Vorbereitete Offline-Aktionen erscheinen hier, bis sie synchronisiert sind.
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						)}
						{hiddenQueueCount > 0 && (
							<>
								<Separator className="my-3" />
								<p className="text-sm text-muted-foreground">
									+{hiddenQueueCount} weitere Aktion
									{hiddenQueueCount === 1 ? '' : 'en'} in der Warteschlange.{' '}
									{primaryWg ? (
										<Button
											variant="link"
											size="lg"
											render={<Link href={wgHref(primaryWg.code, '/einstellungen#daten')} />}
											nativeButton={false}
											className="min-h-11 px-0"
										>
											Alle Aktionen prüfen
										</Button>
									) : (
										'Alle Aktionen prüfen'
									)}{' '}
									öffnet die vollständige Liste.
								</p>
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Zurück in deine WG</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{knownWgs.length === 0 ? (
							<p className="text-sm leading-relaxed text-muted-foreground">
								Noch keine WG auf diesem Gerät gemerkt. Sobald du wieder online bist, kannst du mit
								deinem Code erneut beitreten.
							</p>
						) : (
							<ItemGroup aria-label="Bekannte WGs">
								{knownWgs.slice(0, 3).map((wg) => (
									<Item
										key={wg.code}
										variant="outline"
										render={<Link href={wgHref(wg.code)} aria-label={`${wg.name} öffnen`} />}
									>
										<ItemContent>
											<ItemTitle>{wg.name}</ItemTitle>
											<ItemDescription>
												{formatWgQueuedActionCount(queueCounts.get(wg.code) ?? 0)}
											</ItemDescription>
										</ItemContent>
										<ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
									</Item>
								))}
							</ItemGroup>
						)}

						<div className="grid grid-cols-1 gap-2 pt-2">
							{primaryWg && (
								<Button
									variant="outline"
									size="lg"
									render={<Link href={wgHref(primaryWg.code, '/einstellungen#daten')} />}
									nativeButton={false}
									className="min-h-11 w-full"
								>
									Aktionen prüfen
								</Button>
							)}
							<Button
								variant="outline"
								size="lg"
								render={<Link href="/neu" />}
								nativeButton={false}
								className="min-h-11 w-full"
							>
								Code eingeben
							</Button>
						</div>
					</CardContent>
				</Card>

				<p className="text-center text-xs leading-relaxed text-muted-foreground">
					{queue.length > 0
						? `${Array.from(new Set(queue.map(moduleLabel))).join(', ')} bleibt lokal gespeichert.`
						: 'Du kannst diese Seite schließen. Sobald du online bist, lädt ManaWG wieder normal.'}
				</p>
			</div>
		</main>
	);
}

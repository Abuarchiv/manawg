'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { createSupabaseBrowserClient } from '@/core/auth/client';
import {
	filterOfflineActionsForAuthUser,
	needsManualOfflineResolution,
	readOfflineQueue,
	syncOfflineActions,
} from '@/core/offline/offline-client';
import {
	formatManualOfflineSyncResult,
	getOfflineSyncFailureMessage,
} from '@/core/offline/offline-copy';
import type { OfflineAction } from '@/core/offline/offline-queue';
import { isClientFixtureMode } from '@/shared/lib/fixture-mode';
import { type KnownWg, getKnownWgs, hasLocalIdentityFor } from '@/shared/lib/identity';
import { CloudOff, RefreshCw, RotateCw, Wifi } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KnownWgsCard } from './KnownWgsCard';
import { OfflineQueueCard } from './OfflineQueueCard';
import {
	type OfflineStatus,
	countByShareCode,
	getAccountMemberships,
	moduleLabel,
	offlineStatusCopy,
	visibleKnownWgs,
	visibleQueueCodes,
	wgHref,
} from './offline-page-helpers';

async function getLocalAuthUserId(): Promise<string | null> {
	if (isClientFixtureMode()) return null;
	try {
		const { data, error } = await createSupabaseBrowserClient().auth.getSession();
		return error ? null : (data.session?.user.id ?? null);
	} catch {
		return null;
	}
}

export function OfflineClient() {
	const [online, setOnline] = useState(true);
	const [knownWgs, setKnownWgs] = useState<KnownWg[]>([]);
	const [hasIdentity, setHasIdentity] = useState(false);
	const [queue, setQueue] = useState<OfflineAction[]>([]);
	const [syncing, setSyncing] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [status, setStatus] = useState<OfflineStatus>('checking');
	const syncingRef = useRef(false);
	const syncAbortRef = useRef<AbortController | null>(null);
	const refreshGenerationRef = useRef(0);

	const refresh = useCallback(async (): Promise<OfflineAction[]> => {
		const generation = ++refreshGenerationRef.current;
		const current = () => generation === refreshGenerationRef.current;
		const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
		const fixtureMode = isClientFixtureMode();
		const localAuthUserId = await getLocalAuthUserId();
		if (!current()) return [];
		setOnline(!browserOffline);
		setMessage(null);
		if (browserOffline) {
			const localQueue = fixtureMode
				? readOfflineQueue()
				: filterOfflineActionsForAuthUser(readOfflineQueue(), localAuthUserId);
			const identityOnDevice = hasLocalIdentityFor(localAuthUserId);
			setHasIdentity(identityOnDevice);
			setKnownWgs(visibleKnownWgs(visibleQueueCodes(localQueue), identityOnDevice));
			setQueue(localQueue);
			setStatus(fixtureMode || localAuthUserId ? 'browser-offline' : 'unauthenticated');
			return localQueue;
		}
		try {
			const memberships = await getAccountMemberships();
			if (!current()) return [];
			if (!memberships) {
				setKnownWgs([]);
				setQueue([]);
				setStatus('unauthenticated');
				return [];
			}
			const memberKeys = new Set(memberships.map(({ code, memberId }) => `${code}:${memberId}`));
			const memberCodes = new Set(memberships.map(({ code }) => code));
			const nextQueue = readOfflineQueue().filter((action) =>
				memberKeys.has(`${action.shareCode}:${action.memberId}`),
			);
			setHasIdentity(hasLocalIdentityFor(localAuthUserId));
			setKnownWgs(getKnownWgs().filter((wg) => memberCodes.has(wg.code)));
			setQueue(nextQueue);
			setStatus('ready');
			return nextQueue;
		} catch {
			if (!current()) return [];
			const localQueue = fixtureMode
				? readOfflineQueue()
				: filterOfflineActionsForAuthUser(readOfflineQueue(), localAuthUserId);
			const identityOnDevice = hasLocalIdentityFor(localAuthUserId);
			setHasIdentity(identityOnDevice);
			setKnownWgs(visibleKnownWgs(visibleQueueCodes(localQueue), identityOnDevice));
			setQueue(localQueue);
			setStatus(fixtureMode || localAuthUserId ? 'server-unreachable' : 'unauthenticated');
			return localQueue;
		}
	}, []);

	useEffect(() => {
		void refresh();
		const refreshOnEvent = () => void refresh();
		const onAuthStateChange = () => {
			refreshGenerationRef.current += 1;
			syncAbortRef.current?.abort();
			syncAbortRef.current = null;
			setKnownWgs([]);
			setQueue([]);
			window.setTimeout(refreshOnEvent, 0);
		};
		window.addEventListener('online', refreshOnEvent);
		window.addEventListener('offline', refreshOnEvent);
		window.addEventListener('manawg:offline-queue', refreshOnEvent);
		window.addEventListener('storage', refreshOnEvent);
		let unsubscribe = () => {};
		if (!isClientFixtureMode()) {
			try {
				const { data } = createSupabaseBrowserClient().auth.onAuthStateChange(onAuthStateChange);
				unsubscribe = () => data.subscription.unsubscribe();
			} catch {
				// No cached auth client means local queue data remains hidden.
			}
		}
		return () => {
			unsubscribe();
			syncAbortRef.current?.abort();
			window.removeEventListener('online', refreshOnEvent);
			window.removeEventListener('offline', refreshOnEvent);
			window.removeEventListener('manawg:offline-queue', refreshOnEvent);
			window.removeEventListener('storage', refreshOnEvent);
		};
	}, [refresh]);

	const queueCounts = useMemo(() => countByShareCode(queue), [queue]);
	const hasRetryableQueue = queue.some((action) => !needsManualOfflineResolution(action));
	const primaryWg =
		knownWgs.find((wg) => (queueCounts.get(wg.code) ?? 0) > 0) ?? knownWgs[0] ?? null;
	const lastWg = knownWgs.reduce<KnownWg | null>(
		(latest, wg) => (!latest || wg.lastVisitedAt > latest.lastVisitedAt ? wg : latest),
		null,
	);
	const {
		label: statusLabel,
		heading: statusHeading,
		description: statusDescription,
	} = offlineStatusCopy(status, online);

	async function syncNow() {
		if (syncingRef.current || !hasRetryableQueue) return;
		const controller = new AbortController();
		syncAbortRef.current = controller;
		syncingRef.current = true;
		setSyncing(true);
		setMessage(null);
		try {
			const memberships = await getAccountMemberships(controller.signal);
			if (controller.signal.aborted) return;
			if (!memberships) {
				setKnownWgs([]);
				setQueue([]);
				setStatus('unauthenticated');
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
				if (controller.signal.aborted) return;
				synced += await syncOfflineActions(code, {
					force: true,
					memberId,
					signal: controller.signal,
				});
			}
			if (controller.signal.aborted) return;
			const nextQueue = await refresh();
			setMessage(formatManualOfflineSyncResult(synced, nextQueue.length, { offlineLabel: false }));
		} catch {
			if (controller.signal.aborted) return;
			await refresh();
			setMessage(getOfflineSyncFailureMessage());
		} finally {
			if (syncAbortRef.current === controller) syncAbortRef.current = null;
			syncingRef.current = false;
			setSyncing(false);
		}
	}

	return (
		<main
			id="main"
			tabIndex={-1}
			className="min-h-svh bg-background px-4 pt-[max(1.5rem,env(safe-area-inset-top,0px))] pb-6 text-foreground focus:outline-none"
		>
			<div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-[env(safe-area-inset-bottom)]">
				<header className="flex flex-col gap-3" aria-labelledby="offline-heading">
					<div className="flex items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-2">
							<span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
								{online ? (
									<Wifi className="h-5 w-5 text-primary" aria-hidden />
								) : (
									<CloudOff className="h-5 w-5 text-muted-foreground" aria-hidden />
								)}
							</span>
							<Badge
								variant={status === 'ready' || status === 'checking' ? 'secondary' : 'outline'}
							>
								{statusLabel}
							</Badge>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void refresh()}
							aria-label="Offline-Status erneut prüfen"
							className="shrink-0"
						>
							<RotateCw data-icon="inline-start" aria-hidden />
							Prüfen
						</Button>
					</div>
					<h1
						id="offline-heading"
						className="font-heading text-lg leading-6 font-semibold tracking-tight"
						aria-live="polite"
					>
						{statusHeading}
					</h1>
					<p className="text-sm text-muted-foreground">{statusDescription}</p>
					{lastWg && status !== 'unauthenticated' && (
						<Button
							size="lg"
							render={<Link href={wgHref(lastWg.code)} />}
							nativeButton={false}
							className="w-full"
						>
							Zurück zu {lastWg.name}
						</Button>
					)}
					{status === 'unauthenticated' && (
						<Button size="lg" render={<Link href="/neu" />} nativeButton={false} className="w-full">
							Anmelden
						</Button>
					)}
					{queue.length > 0 && hasRetryableQueue && (
						<Button
							type="button"
							onClick={syncNow}
							disabled={syncing}
							aria-label={
								syncing
									? 'Offline-Aktionen werden synchronisiert'
									: 'Offline-Aktionen jetzt synchronisieren'
							}
							size="lg"
							className="w-full"
						>
							{syncing ? (
								<Spinner className="motion-reduce:animate-none" aria-hidden />
							) : (
								<RefreshCw data-icon="inline-start" aria-hidden />
							)}
							Jetzt synchronisieren
						</Button>
					)}
					{message && (
						<Alert>
							<AlertTitle>Synchronisation</AlertTitle>
							<AlertDescription>
								<output aria-live="polite">{message}</output>
							</AlertDescription>
						</Alert>
					)}
				</header>

				<OfflineQueueCard queue={queue} primaryWg={primaryWg} />

				{status !== 'unauthenticated' && (
					<KnownWgsCard
						status={status}
						knownWgs={knownWgs}
						hasIdentity={hasIdentity}
						queueCounts={queueCounts}
						primaryWg={primaryWg}
					/>
				)}

				{(status === 'browser-offline' || status === 'server-unreachable') && (
					<p className="text-center text-xs leading-relaxed text-muted-foreground">
						{queue.length > 0
							? `${Array.from(new Set(queue.map(moduleLabel))).join(', ')} bleibt lokal gespeichert.`
							: 'Du kannst diese Seite schließen. Sobald du online bist, lädt ManaWG wieder normal.'}
					</p>
				)}
			</div>
		</main>
	);
}

'use client';

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
import { type KnownWg, getKnownWgs } from '@manawg/shared/lib/identity';
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

export function OfflineClient() {
	const [online, setOnline] = useState(true);
	const [knownWgs, setKnownWgs] = useState<KnownWg[]>([]);
	const [queue, setQueue] = useState<OfflineAction[]>([]);
	const [syncing, setSyncing] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const syncingRef = useRef(false);

	const refresh = useCallback((): OfflineAction[] => {
		setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
		setKnownWgs(getKnownWgs());
		const nextQueue = readOfflineQueue();
		setQueue(nextQueue);
		setMessage(null);
		return nextQueue;
	}, []);

	useEffect(() => {
		refresh();
		window.addEventListener('online', refresh);
		window.addEventListener('offline', refresh);
		window.addEventListener('manawg:offline-queue', refresh);
		return () => {
			window.removeEventListener('online', refresh);
			window.removeEventListener('offline', refresh);
			window.removeEventListener('manawg:offline-queue', refresh);
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
			const synced = await syncOfflineActions(undefined, { force: true });
			const nextQueue = refresh();
			setMessage(formatManualOfflineSyncResult(synced, nextQueue.length, { offlineLabel: false }));
		} catch {
			refresh();
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
			className="min-h-svh bg-[var(--bg-base)] px-4 py-6 text-[var(--text-1)] sm:px-6 focus:outline-none"
		>
			<div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-xl flex-col justify-center gap-5">
				<section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
					<div className="flex items-start gap-3">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)]">
							{online ? (
								<Wifi className="h-5 w-5 text-[var(--accent)]" aria-hidden />
							) : (
								<CloudOff className="h-5 w-5 text-[var(--text-2)]" aria-hidden />
							)}
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-3)]">
								{online ? 'Wieder online' : 'Offline-Modus'}
							</p>
							<h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em]" aria-live="polite">
								{online ? 'Du bist wieder verbunden.' : 'Du bist gerade offline.'}
							</h1>
							<p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">
								ManaWG speichert vorbereitete Aktionen auf diesem Gerät. Sobald das Netz zurück ist,
								kannst du sie synchronisieren und in deine WG zurückspringen.
							</p>
						</div>
					</div>

					<div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
						<button
							type="button"
							onClick={syncNow}
							disabled={syncing || queue.length === 0}
							aria-label={
								syncing
									? 'Offline-Aktionen werden synchronisiert'
									: 'Offline-Aktionen jetzt synchronisieren'
							}
							className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--text-1)] px-3 text-sm font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
							Jetzt synchronisieren
						</button>
						<button
							type="button"
							onClick={refresh}
							aria-label="Offline-Status erneut prüfen"
							className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
						>
							<RotateCw className="h-4 w-4" aria-hidden />
							Prüfen
						</button>
					</div>

					{message && (
						<output
							className="mt-3 block rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-3 py-2 text-sm text-[var(--accent)]"
							aria-live="polite"
						>
							{message}
						</output>
					)}
				</section>

				<section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-sm">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-base font-semibold">Warteschlange</h2>
							<p className="mt-1 text-sm text-[var(--text-3)]">
								{formatQueuedActionCount(queue.length)}
							</p>
						</div>
						{queue.length === 0 && (
							<CheckCircle2 className="h-5 w-5 text-[var(--accent)]" aria-hidden />
						)}
					</div>

					{recentQueue.length > 0 && (
						<ul className="mt-4 divide-y divide-[var(--border)]">
							{recentQueue.map((item) => {
								const summary = getOfflineActionSummary(item);
								const risk = getOfflineActionRisk(item);
								return (
									<li key={item.id} className="py-3 first:pt-0 last:pb-0">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="text-sm font-medium text-[var(--text-1)]">{summary.title}</p>
												<p className="mt-0.5 truncate text-sm text-[var(--text-2)]">
													{summary.detail}
												</p>
												{item.lastError && (
													<p className="mt-1 text-xs text-[var(--danger)]">{item.lastError}</p>
												)}
												{risk && (
													<p className="mt-1 text-xs text-[var(--warning-fg)]">
														{risk.title}: {risk.detail}
													</p>
												)}
											</div>
											<span className="shrink-0 text-xs text-[var(--text-3)]">
												{formatOfflineAge(item.createdAt)}
											</span>
										</div>
									</li>
								);
							})}
							{hiddenQueueCount > 0 && (
								<li className="py-3 text-sm text-[var(--text-2)]">
									+{hiddenQueueCount} weitere Aktion
									{hiddenQueueCount === 1 ? '' : 'en'} in der Warteschlange.{' '}
									{primaryWg ? (
										<Link
											href={wgHref(primaryWg.code, '/einstellungen#daten')}
											className="font-medium text-[var(--accent)] underline underline-offset-2"
										>
											Alle Aktionen prüfen
										</Link>
									) : (
										'Alle Aktionen prüfen'
									)}{' '}
									öffnet die vollständige Liste.
								</li>
							)}
						</ul>
					)}
				</section>

				<section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-sm">
					<h2 className="text-base font-semibold">Zurück in deine WG</h2>
					{knownWgs.length === 0 ? (
						<p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">
							Noch keine WG auf diesem Gerät gemerkt. Sobald du wieder online bist, kannst du mit
							deinem Code erneut beitreten.
						</p>
					) : (
						<div className="mt-3 space-y-2">
							{knownWgs.slice(0, 3).map((wg) => (
								<Link
									key={wg.code}
									href={wgHref(wg.code)}
									className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:border-[var(--border-strong)]"
								>
									<span className="min-w-0">
										<span className="block truncate font-medium text-[var(--text-1)]">
											{wg.name}
										</span>
										<span className="text-xs text-[var(--text-3)]">
											{formatWgQueuedActionCount(queueCounts.get(wg.code) ?? 0)}
										</span>
									</span>
									<ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden />
								</Link>
							))}
						</div>
					)}

					<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
						{primaryWg && (
							<Link
								href={wgHref(primaryWg.code, '/einstellungen#daten')}
								className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
							>
								Aktionen prüfen
							</Link>
						)}
						<Link
							href="/neu"
							className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--border)] px-3 text-sm font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
						>
							Code eingeben
						</Link>
					</div>
				</section>

				<p className="text-center text-xs leading-relaxed text-[var(--text-3)]">
					{queue.length > 0
						? `${Array.from(new Set(queue.map(moduleLabel))).join(', ')} bleibt lokal gespeichert.`
						: 'Du kannst diese Seite schließen. Sobald du online bist, lädt ManaWG wieder normal.'}
				</p>
			</div>
		</main>
	);
}

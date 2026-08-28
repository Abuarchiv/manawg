'use client';

import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { ActivityFeed } from '@/components/wg/dashboard/ActivityFeed';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { apiFetch } from '@/core/infra/api-client';
import {
	type ActivityFilter,
	type ActivityItem,
	type ActivityKind,
	type ActivityReminder,
	type ActivityScope,
	buildActivityInbox,
	filterActivityByScope,
	filterActivityItems,
	getActivityEmptyActionHref,
	groupActivityItemsByDay,
} from '@/lib/wg/activity';
import { AlertTriangle, ArrowLeft, ListFilter, Loader2, RotateCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ActivityResponse {
	items: ActivityItem[];
	reminders: ActivityReminder[];
}

function formatVisibleActivityCount(count: number): string {
	if (count === 0) return 'Keine sichtbaren Chronik-Einträge.';
	if (count === 1) return '1 Chronik-Eintrag sichtbar.';
	return `${count} Chronik-Einträge sichtbar.`;
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function AktivitaetPage() {
	const { wg, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [data, setData] = useState<ActivityResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [filter, setFilter] = useState<ActivityFilter>({ kind: 'all', mineOnly: false, query: '' });
	const [scope, setScope] = useState<ActivityScope>('all');
	const requestIdRef = useRef(0);

	const load = useCallback(async (): Promise<void> => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setLoading(true);
		try {
			const res = await apiFetch<ActivityResponse>(`/api/wg/${encodedShareCode}/activity`, {
				memberId: identity.memberId,
			});
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
	}, [encodedShareCode, identity.memberId]);

	useEffect(() => {
		void load();
	}, [load]);

	const filteredItems = useMemo(
		() =>
			filterActivityByScope(
				filterActivityItems(data?.items ?? [], filter, identity.name, identity.memberId),
				scope,
				identity.name,
				identity.memberId,
			),
		[data?.items, filter, identity.memberId, identity.name, scope],
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
		() =>
			data
				? buildActivityInbox({
						reminders: data.reminders,
						items: data.items,
						currentMemberName: identity.name,
						currentMemberId: identity.memberId,
					})
				: [],
		[data, identity.memberId, identity.name],
	);
	const openInboxCount = inboxItems.filter((item) => item.priority === 'high').length;
	const inboxCountLabel =
		openInboxCount > 0 ? `${openInboxCount} offen` : `${inboxItems.length} für dich`;

	function setKind(kind: ActivityKind | 'all'): void {
		setFilter((current) => ({ ...current, kind }));
	}

	const hasActiveFilter =
		scope !== 'all' || filter.kind !== 'all' || filter.mineOnly || filter.query.trim().length > 0;

	function resetFilters(): void {
		setScope('all');
		setFilter({ kind: 'all', mineOnly: false, query: '' });
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-center gap-3">
				<Link
					href={wgBaseHref}
					aria-label="Zurück zum Dashboard"
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden />
				</Link>
				<div className="min-w-0 flex-1">
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						Aktivität
					</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
						Verlauf, Erinnerungen und offene Klärungen.
					</p>
				</div>
				<button
					type="button"
					onClick={() => void load()}
					disabled={loading}
					aria-label="Aktivität aktualisieren"
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
				</button>
			</header>

			{error && (
				<LoadErrorBanner
					message={error}
					onRetry={() => void load()}
					busy={loading}
					retryLabel="Aktivität erneut laden"
				/>
			)}

			{data && (
				<section className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger)]/5 p-4">
					<div className="mb-3 flex items-center justify-between gap-2">
						<div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-1)]">
							<AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
							Inbox
						</div>
						<span className="rounded-full bg-[var(--bg-base)] px-2 py-1 text-[11px] text-[var(--text-3)]">
							{inboxCountLabel}
						</span>
					</div>
					{inboxItems.length > 0 ? (
						<ul className="space-y-2">
							{inboxItems.map((item) => (
								<li key={item.id}>
									<Link
										href={`${wgBaseHref}${item.href}`}
										className="block min-h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[13px] transition-colors hover:border-[var(--border-strong)]"
									>
										<span className="flex items-center justify-between gap-2 font-medium text-[var(--text-1)]">
											<span className="line-clamp-1">{item.title}</span>
											{item.priority === 'high' && (
												<span className="shrink-0 text-[11px] text-[var(--danger)]">wichtig</span>
											)}
										</span>
										<span className="mt-0.5 block line-clamp-1 text-[12px] text-[var(--text-3)]">
											{item.detail}
										</span>
									</Link>
								</li>
							))}
						</ul>
					) : (
						<p className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-base)] px-3 py-4 text-center text-[13px] text-[var(--text-3)]">
							Keine offenen Klärungen.
						</p>
					)}
				</section>
			)}

			<section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3">
				<label className="relative block">
					<span className="sr-only">Aktivität durchsuchen</span>
					<Search
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]"
						aria-hidden
					/>
					<input
						type="search"
						value={filter.query}
						onChange={(event) => {
							const query = event.currentTarget.value;
							setFilter((current) => ({ ...current, query }));
						}}
						placeholder="Aktivität durchsuchen"
						className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] pl-9 pr-3 text-[14px] text-[var(--text-1)] outline-none transition-colors placeholder:text-[var(--text-3)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15"
					/>
				</label>
				{/* biome-ignore lint/a11y/useSemanticElements: button toolbar group; <fieldset> would change layout semantics */}
				<div className="flex flex-wrap gap-2" role="group" aria-label="Aktivitätsumfang filtern">
					{[
						['all', 'Alle'],
						['system', 'System'],
						['mine', 'Von mir'],
						['changes', 'Änderungen'],
						['done', 'Erledigungen'],
					].map(([value, label]) => (
						<button
							key={value}
							type="button"
							onClick={() => {
								setScope(value as ActivityScope);
								setFilter((current) =>
									value === 'mine' ? { ...current, mineOnly: false } : current,
								);
							}}
							aria-label={value === 'all' ? 'Aktivitätsumfang: Alle' : undefined}
							aria-pressed={scope === value}
							className={`inline-flex h-11 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
								scope === value
									? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
									: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
							}`}
						>
							{label}
						</button>
					))}
				</div>
				<div
					// biome-ignore lint/a11y/useSemanticElements: filter toolbar — group role conveys related filter buttons to AT; no semantic HTML element fits
					className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3"
					role="group"
					aria-label="Aktivitätstyp filtern"
				>
					{[
						['all', 'Alle'],
						['expense', 'Ausgaben'],
						['shopping', 'Einkauf'],
						['announcement', 'Pinnwand'],
						['chore', 'Putzen'],
						['recurring', 'Fixkosten'],
						['absence', 'Abwesenheiten'],
						['audit', 'Audit'],
					].map(([value, label]) => (
						<button
							key={value}
							type="button"
							onClick={() => setKind(value as ActivityKind | 'all')}
							aria-label={value === 'all' ? 'Aktivitätstyp: Alle' : undefined}
							aria-pressed={filter.kind === value}
							className={`inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
								filter.kind === value
									? 'border-[var(--text-1)] bg-[var(--text-1)] text-[var(--bg-base)]'
									: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
							}`}
						>
							<ListFilter className="h-3.5 w-3.5" aria-hidden />
							{label}
						</button>
					))}
					<button
						type="button"
						onClick={() => setFilter((current) => ({ ...current, mineOnly: !current.mineOnly }))}
						aria-pressed={filter.mineOnly}
						className={`inline-flex h-11 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
							filter.mineOnly
								? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
								: 'border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)] hover:text-[var(--text-1)]'
						}`}
					>
						Nur ich
					</button>
				</div>
			</section>

			<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-5">
				{data ? (
					chronicleGroups.length > 0 ? (
						<div className="space-y-5">
							<output aria-live="polite" className="block text-[12.5px] text-[var(--text-3)]">
								{formatVisibleActivityCount(filteredItems.length)}
							</output>
							{chronicleGroups.map((group) => (
								<div key={group.date} className="space-y-2">
									<div className="flex items-center gap-2">
										<h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
											{group.label}
										</h2>
										<span className="h-px flex-1 bg-[var(--border)]" aria-hidden />
										<span className="text-[11px] tabular-nums text-[var(--text-3)]">
											{group.items.length}
										</span>
									</div>
									<ActivityFeed items={group.items} />
								</div>
							))}
						</div>
					) : hasActiveFilter ? (
						<div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center">
							<output aria-live="polite" className="mb-2 block text-[12.5px] text-[var(--text-3)]">
								{formatVisibleActivityCount(filteredItems.length)}
							</output>
							<p className="text-[13px] text-[var(--text-3)]">Keine Aktivität für diesen Filter.</p>
							<button
								type="button"
								onClick={resetFilters}
								className="mt-3 inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								Filter zurücksetzen
							</button>
						</div>
					) : (
						<div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center">
							<p className="text-[14px] font-medium text-[var(--text-1)]">Noch keine Aktivität.</p>
							<p className="mx-auto mt-1 max-w-sm text-[13px] text-[var(--text-3)]">
								Sobald jemand etwas einträgt, erledigt oder kommentiert, entsteht hier euer Verlauf.
							</p>
							<div className="mt-4 flex flex-wrap justify-center gap-2">
								<Link
									href={getActivityEmptyActionHref(wg.shareCode, 'expense', {
										desc: 'Internet',
										amount: '32,90',
									})}
									className="inline-flex h-11 items-center rounded-md bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								>
									Ausgabe eintragen
								</Link>
								<Link
									href={getActivityEmptyActionHref(wg.shareCode, 'announcement', {
										content: 'Paket im Flur',
										kind: 'question',
									})}
									className="inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								>
									Pinnwand starten
								</Link>
								<Link
									href={getActivityEmptyActionHref(wg.shareCode, 'chore', {
										title: 'Bad putzen',
									})}
									className="inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								>
									Putzplan anlegen
								</Link>
							</div>
						</div>
					)
				) : loading ? (
					<div className="flex justify-center py-10">
						<Loader2 className="h-5 w-5 animate-spin text-[var(--text-3)]" aria-hidden />
					</div>
				) : (
					<p className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-[13px] text-[var(--text-3)]">
						Keine Aktivität geladen. Versuche es erneut.
					</p>
				)}
			</section>
		</div>
	);
}

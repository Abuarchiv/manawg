'use client';

import { WgWelcome } from '@/components/entry/WgWelcome';
import { ChatTopBarLink } from '@/components/wg/ChatTopBarLink';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useWg } from '@/components/wg/WgContextProvider';
import { ActivityFeed } from '@/components/wg/dashboard/ActivityFeed';
import { ActivitySkeleton, ChoreSkeleton } from '@/components/wg/dashboard/DashboardSkeletons';
import { ModuleCard } from '@/components/wg/dashboard/ModuleCard';
import { Panel } from '@/components/wg/dashboard/Panel';
import { Sparkline } from '@/components/wg/dashboard/Sparkline';
import { Stat } from '@/components/wg/dashboard/Stat';
import { TodayIcon } from '@/components/wg/dashboard/TodayIcon';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import type { DashboardData } from '@/core/reads/dashboard-data';
import {
	getTodayFocus,
	getTodayImportantItems,
	getTodayListItems,
} from '@/core/reads/dashboard-insights';
import {
	getDashboardAnnouncementHref,
	getDashboardEmptyActionHref,
} from '@/core/reads/dashboard-links';
import { formatEuroCents } from '@/core/utils/money';
import { MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { haptic } from '@/shared/lib/haptics';
import {
	AlertTriangle,
	ChevronDown,
	ListChecks,
	Megaphone,
	Receipt,
	Settings,
	Sparkles,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Dynamic + ssr:false: both create-WG (NeuClient's createWg → InviteStep
// "Später" skip) and join-WG (NeuClient's joinExistingWg) land here, on the
// dashboard — the natural moment to offer push notifications once, without
// adding its JS to every /wg/[code]/* route (this page has bundle headroom;
// see the einstellungen tabs above for the same on-demand pattern). It also
// depends on browser-only APIs (Notification, localStorage) with nothing to
// server-render.
const PushPrimingPrompt = dynamic(
	() => import('@/shared/components/push-priming-prompt').then((m) => m.PushPrimingPrompt),
	{ ssr: false },
);

const REFRESH_INTERVAL_MS = 30_000;

function formatEuro(cents: number, opts?: { signed?: boolean }): string {
	return formatEuroCents(cents, 'EUR', opts);
}

function dueRelative(iso: string): { text: string; tone: 'ok' | 'soon' | 'overdue' } {
	const due = parseTimestamp(iso);
	if (due === null) return { text: 'Datum prüfen', tone: 'soon' };
	const now = Date.now();
	const diffDays = Math.round((due - now) / MS_PER_DAY);
	if (diffDays < 0)
		return {
			text: `${Math.abs(diffDays)} T. überfällig`,
			tone: 'overdue',
		};
	if (diffDays === 0) return { text: 'heute', tone: 'soon' };
	if (diffDays === 1) return { text: 'morgen', tone: 'soon' };
	if (diffDays <= 3) return { text: `in ${diffDays} T.`, tone: 'soon' };
	return { text: `in ${diffDays} T.`, tone: 'ok' };
}

async function readDashboardError(response: Response): Promise<string | null> {
	try {
		const body = (await response.clone().json()) as { code?: unknown; error?: unknown };
		if (typeof body.code === 'string') return body.code;
		if (typeof body.error === 'string') return body.error;
	} catch {
		return null;
	}
	return null;
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function WgHomePage() {
	const { wg, members, identity } = useWg();
	// Current WG occupancy for the visible member surfaces (header count, member
	// panel). Moved-out members stay in `members` for name/color resolution but
	// drop out of these lists ("aus Listen raus").
	const activeMembers = members.filter((m) => m.active);
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const dashboardRequestId = useRef(0);
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;

	const load = useCallback(async (): Promise<void> => {
		const requestId = dashboardRequestId.current + 1;
		dashboardRequestId.current = requestId;
		setLoading(true);
		try {
			const res = await fetch(`/api/wg/${encodedShareCode}/dashboard`, {
				cache: 'no-store',
				headers: { 'x-manawg-member-id': identity.memberId },
			});
			if (requestId !== dashboardRequestId.current) return;
			if (!res.ok) {
				setError(getWgLoadErrorMessage('Dashboard', res.status, await readDashboardError(res)));
				return;
			}
			const json = (await res.json()) as DashboardData;
			if (requestId !== dashboardRequestId.current) return;
			setData(json);
			setError(null);
		} catch {
			if (requestId !== dashboardRequestId.current) return;
			setError(getWgLoadErrorMessage('Dashboard', 0, 'Netzwerkfehler'));
		} finally {
			if (requestId === dashboardRequestId.current) setLoading(false);
		}
	}, [encodedShareCode, identity.memberId]);

	useEffect(() => {
		void load();
	}, [load]);
	useVisibilityPausedInterval(() => void load(), REFRESH_INTERVAL_MS);

	const myBalance = data?.balances.find((b) => b.memberId === identity.memberId)?.balanceCents ?? 0;
	const sparkValues = data?.spendByDay.map((d) => d.cents) ?? [];
	const urgentChores = useMemo(
		() =>
			data?.dueChores.filter(
				(item) => item.overdue || dueRelative(item.nextDueAt).tone === 'soon',
			) ?? [],
		[data],
	);
	const todayImportant = useMemo(
		() =>
			data
				? getTodayImportantItems({
						shareCode: wg.shareCode,
						myBalanceCents: myBalance,
						openShoppingTop: data.openShoppingTop,
						dueChores: urgentChores,
						myOpenAnnouncements: data.myOpenAnnouncements,
						dueRecurringExpenses: data.dueRecurringExpenses,
						absentMembers: data.absentMembers,
					})
				: [],
		[data, wg.shareCode, myBalance, urgentChores],
	);
	const todayFocus = useMemo(() => getTodayFocus(todayImportant), [todayImportant]);
	const todayListItems = useMemo(
		() => getTodayListItems(todayImportant, todayFocus),
		[todayImportant, todayFocus],
	);
	return (
		<>
			<PushPrimingPrompt
				code={wg.shareCode}
				memberId={identity.memberId}
				memberToken={identity.memberToken}
			/>
			<div className="mx-auto w-full max-w-4xl space-y-8 overflow-x-clip px-4 py-6 sm:px-6 sm:py-8">
				{/* ─── HEADER ─── */}
				<header className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-2.5">
							<LogoMark size={24} radius={6} className="shrink-0 rounded-md" />
							<h1
								title={wg.name}
								className="min-w-0 flex-1 break-words line-clamp-2 text-[26px] font-semibold leading-[1.15] tracking-[-0.022em] text-[var(--text-1)] sm:text-[28px]"
							>
								{wg.name}
							</h1>
						</div>
						<p className="mt-1 pl-[34px] text-sm text-[var(--text-2)]">
							{activeMembers.length} Mitglied{activeMembers.length === 1 ? '' : 'er'}
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<ChatTopBarLink
							href={`${wgBaseHref}/chat`}
							className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						/>
						<Link
							href={`${wgBaseHref}/einstellungen`}
							aria-label="WG-Einstellungen öffnen"
							className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] shadow-sm transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							<Settings className="h-4 w-4" aria-hidden />
						</Link>
					</div>
				</header>

				{error && (
					<div
						role="alert"
						className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
					>
						<span className="flex min-w-0 items-center gap-2">
							<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
							<span>{error}</span>
						</span>
						<button
							type="button"
							onClick={() => void load()}
							disabled={loading}
							aria-busy={loading}
							className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{loading ? 'Lädt...' : 'Dashboard erneut laden'}
						</button>
						<output aria-live="polite" className="sr-only">
							{loading ? 'Dashboard wird neu geladen' : ''}
						</output>
					</div>
				)}

				<WgWelcome variant="member" wgName={wg.name} />

				{/* ─── STAT ROW ─── */}
				<section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]">
					<dl className="grid grid-cols-3 divide-x divide-[var(--border)]">
						<Stat
							label="Deine Bilanz"
							value={data ? formatEuro(myBalance, { signed: true }) : '—'}
							tone={myBalance > 0 ? 'positive' : myBalance < 0 ? 'negative' : 'neutral'}
							sub={
								data
									? myBalance > 0
										? 'wird erstattet'
										: myBalance < 0
											? 'schulde ich'
											: 'ausgeglichen'
									: undefined
							}
							subTone={data && myBalance < 0 ? 'danger' : 'neutral'}
						/>
						<Stat
							label="Diese Woche"
							value={data ? formatEuro(data.weekSpendCents) : '—'}
							sub="7 Tage"
						/>
						<Stat
							label="Dieser Monat"
							value={data ? formatEuro(data.monthSpendCents) : '—'}
							sub="30 Tage"
						/>
					</dl>
					<div className="border-t border-[var(--border)] px-4 py-3 sm:px-5">
						<div className="mb-2 flex items-baseline justify-between">
							<span className="text-[12.5px] text-[var(--text-3)]">Ausgaben · 14 Tage</span>
							<Link
								href={`${wgBaseHref}/ausgaben`}
								className="-mx-2 inline-flex min-h-11 items-center px-2 text-[12.5px] text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
							>
								Alle ansehen →
							</Link>
						</div>
						<Sparkline
							values={sparkValues}
							width={800}
							height={48}
							className="w-full"
							aria-label="Ausgaben pro Tag, letzte 14 Tage"
						/>
					</div>
				</section>

				{/* Kein lg:-Grid: der App-Frame bleibt handybreit, Viewport-Breakpoints
				    erzeugten am Desktop halb-leere Reihen. */}
				{data && (
					<section className="grid gap-3">
						<Panel title="Für dich heute">
							{todayFocus && (
								<Link
									href={todayFocus.href}
									className={`mb-3 block rounded-lg border px-4 py-3 transition-colors ${
										todayFocus.tone === 'danger'
											? 'border-[var(--border)] bg-[var(--danger)]/5 hover:bg-[var(--danger)]/10'
											: 'border-[var(--border)] bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10'
									}`}
								>
									<span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
										Heute wichtig
									</span>
									<span className="mt-1 block text-[15px] font-semibold text-[var(--text-1)]">
										{todayFocus.title}
									</span>
									<span className="mt-0.5 block text-[12.5px] text-[var(--text-2)]">
										{todayFocus.detail} · {todayFocus.actionLabel}
									</span>
								</Link>
							)}
							<ul className="space-y-2">
								{todayListItems.map((item) => (
									<li key={`${item.kind}:${item.href}`}>
										<Link
											href={item.href}
											className="flex min-h-[48px] items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[13px] transition-colors hover:border-[var(--border-strong)]"
										>
											<span className="flex min-w-0 items-center gap-2">
												<TodayIcon kind={item.kind} />
												<span className="truncate text-[var(--text-1)]">{item.title}</span>
											</span>
											<span
												className={`shrink-0 ${
													item.tone === 'danger'
														? 'text-[var(--danger)]'
														: item.tone === 'accent'
															? 'text-[var(--accent)]'
															: 'text-[var(--text-3)]'
												}`}
											>
												<span className="sr-only">
													{item.tone === 'danger'
														? 'dringend: '
														: item.tone === 'accent'
															? 'normal: '
															: 'still: '}
												</span>
												{item.detail}
											</span>
											<span className="hidden rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)] sm:inline">
												{item.tone === 'danger'
													? 'dringend'
													: item.tone === 'accent'
														? 'normal'
														: 'still'}
											</span>
										</Link>
									</li>
								))}
								{todayListItems.length === 0 && (
									<li className="rounded-md border border-dashed border-[var(--border)] px-3 py-5 text-center text-[13px] text-[var(--text-3)]">
										Nichts Dringendes. Deine WG ist gerade ruhig.
									</li>
								)}
							</ul>
						</Panel>
					</section>
				)}

				{/* Nur zeigen, wenn etwas zu tun ist — 6 Null-Kacheln bei ruhiger WG sind Rauschen. */}
				{data && data.wgHealth.score < 100 && (
					<details className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4">
						<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
							<span>
								<span className="block text-sm font-semibold text-[var(--text-1)]">
									WG-Gesundheit
								</span>
								<span className="mt-0.5 block text-[12.5px] text-[var(--text-3)]">
									{data.wgHealth.label}
								</span>
							</span>
							<span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[13px] font-semibold tabular-nums text-[var(--text-1)]">
								{data.wgHealth.score}/100
							</span>
						</summary>
						<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
							{data.wgHealth.items.map((item) => (
								<Link
									key={item.label}
									href={item.href}
									className="rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 transition-colors hover:border-[var(--border-strong)]"
								>
									<p className="text-[11.5px] text-[var(--text-3)]">{item.label}</p>
									<p
										className={`mt-0.5 text-[13px] font-semibold ${
											item.tone === 'danger'
												? 'text-[var(--danger)]'
												: item.tone === 'warn'
													? 'text-[var(--accent)]'
													: 'text-[var(--text-1)]'
										}`}
									>
										<span className="sr-only">
											{item.tone === 'danger'
												? 'kritisch: '
												: item.tone === 'warn'
													? 'Warnung: '
													: 'OK: '}
										</span>
										{item.value}
									</p>
								</Link>
							))}
						</div>
					</details>
				)}

				{/* ─── MODULES ─── */}
				{/* grid-cols-1 below 360px prevents two-column overflow on smallest phones.
				    Max 2 Spalten: bei 4 Spalten im schmalen App-Frame truncaten die Kartentitel. */}
				<section
					aria-labelledby="modules-heading"
					className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2"
				>
					<h2 id="modules-heading" className="sr-only">
						Module
					</h2>
					<div className="contents" onPointerDown={() => haptic('selection')}>
						<ModuleCard
							href={`${wgBaseHref}/ausgaben`}
							Icon={Receipt}
							title="Ausgaben"
							primary={data ? formatEuro(data.monthSpendCents) : '—'}
							secondary={
								data && data.monthSpendCents > 0 ? 'in den letzten 30 Tagen' : 'noch keine Einträge'
							}
						/>
					</div>
					<div className="contents" onPointerDown={() => haptic('selection')}>
						<ModuleCard
							href={`${wgBaseHref}/einkauf`}
							Icon={ListChecks}
							title="Einkauf"
							primary={data ? String(data.openShoppingCount) : '—'}
							badge={
								data && data.openShoppingCount > 0 ? (
									<span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-2)]">
										offen
									</span>
								) : undefined
							}
							secondary={
								data && data.openShoppingTop.length > 0
									? data.openShoppingTop.join(' · ')
									: 'Liste ist leer'
							}
						/>
					</div>
					<div className="contents" onPointerDown={() => haptic('selection')}>
						<ModuleCard
							href={`${wgBaseHref}/putzen`}
							Icon={Sparkles}
							title="Putzen"
							primary={
								data && data.dueChores.length > 0
									? String(data.dueChores.filter((c) => c.overdue).length || data.dueChores.length)
									: '0'
							}
							badge={
								data?.dueChores.some((c) => c.overdue) ? (
									<span className="rounded-full border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-1.5 py-0.5 text-[11px] font-medium text-[var(--danger)]">
										überfällig
									</span>
								) : undefined
							}
							secondary={
								data?.dueChores[0]
									? `${data.dueChores[0].title}${
											data.dueChores[0].assignedMemberName
												? ` · ${data.dueChores[0].assignedMemberName}`
												: ''
										}`
									: 'kein Putzdienst aktiv'
							}
						/>
					</div>
					<div className="contents" onPointerDown={() => haptic('selection')}>
						<ModuleCard
							href={
								data?.myOpenAnnouncements[0]
									? getDashboardAnnouncementHref(wg.shareCode, data.myOpenAnnouncements[0].id)
									: `${wgBaseHref}/pinnwand`
							}
							Icon={Megaphone}
							title="Pinnwand"
							primary={
								data
									? String(data.myOpenAnnouncements.length || (data.latestAnnouncement ? 1 : 0))
									: '—'
							}
							badge={
								data && data.myOpenAnnouncements.length > 0 ? (
									<span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
										deins
									</span>
								) : undefined
							}
							secondary={
								data && data.myOpenAnnouncements.length > 0
									? data.myOpenAnnouncements[0]?.content
									: data?.latestAnnouncement
										? `${data.latestAnnouncement.authorName}: ${data.latestAnnouncement.content.slice(0, 60)}${data.latestAnnouncement.content.length > 60 ? '…' : ''}`
										: 'keine Ankündigungen'
							}
						/>
					</div>
				</section>

				{data && data.myOpenAnnouncements.length > 0 && (
					<section className="rounded-lg border border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<h2 className="text-sm font-semibold text-[var(--text-1)]">Meine offenen Sachen</h2>
							<Link
								href={getDashboardAnnouncementHref(
									wg.shareCode,
									data.myOpenAnnouncements[0]?.id ?? '',
								)}
								className="text-[12.5px] font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-bright)]"
							>
								Pinnwand
							</Link>
						</div>
						<ul className="grid gap-2 sm:grid-cols-2">
							{data.myOpenAnnouncements.map((item) => (
								<li key={item.id}>
									<Link
										href={getDashboardAnnouncementHref(wg.shareCode, item.id)}
										className="block min-h-[48px] rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
									>
										<span className="line-clamp-2">{item.content}</span>
									</Link>
								</li>
							))}
						</ul>
					</section>
				)}

				{/* ─── ACTIVITY ─── */}
				<section>
					<details className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-5">
						<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
							<span className="text-sm font-semibold text-[var(--text-1)]">Letzte Aktivität</span>
							<ChevronDown className="h-4 w-4 text-[var(--text-3)]" aria-hidden />
						</summary>
						<div className="mt-3">
							{data ? (
								<ActivityFeed
									items={data.activity}
									emptyHref={getDashboardEmptyActionHref(wg.shareCode, 'announcement', {
										kind: 'info',
										content: 'Hallo zusammen!',
									})}
								/>
							) : (
								<ActivitySkeleton />
							)}
							{/* Einziger Einstieg in die vollständige Chronik mit Filtern —
							    Aktivität hat keinen Platz mehr in der Hauptnavigation,
							    weil der Auszug hier schon steht. */}
							<Link
								href={`${wgBaseHref}/aktivitaet`}
								className="mt-3 inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							>
								Ganze Chronik
							</Link>
						</div>
					</details>
				</section>

				{/* ─── DUE ───
				    A "Mitglieder" panel used to sit next to this one, listing every
				    active member by name — a pure duplicate of the member roster on
				    Einstellungen → Zugang (same names, plus management actions).
				    It didn't even link anywhere. Removed rather than kept "for
				    completeness" — that's the kind of redundant block Priorität 3
				    (Informationsdichte) is about cutting. */}
				<section>
					<Panel title="Anstehende Aufgaben" linkHref={`${wgBaseHref}/putzen`}>
						{data && data.dueChores.length > 0 ? (
							<ul className="divide-y divide-[var(--border)]">
								{data.dueChores.map((c) => {
									const rel = dueRelative(c.nextDueAt);
									return (
										<li
											key={c.id}
											className="flex min-h-[48px] items-center gap-3 py-2 first:pt-0 last:pb-0"
										>
											{c.assignedMemberName ? (
												<MemberAvatar
													name={c.assignedMemberName}
													color={c.assignedColor ?? null}
													size={28}
												/>
											) : (
												<span
													aria-hidden
													className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[11px] text-[var(--text-3)]"
												>
													?
												</span>
											)}
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm text-[var(--text-1)]">{c.title}</p>
												<p className="truncate text-[12px] text-[var(--text-3)]">
													{c.assignedMemberName ?? 'niemand zugewiesen'}
												</p>
											</div>
											<span
												className={`shrink-0 tabular-nums text-[12.5px] ${
													rel.tone === 'overdue'
														? 'text-[var(--danger)]'
														: rel.tone === 'soon'
															? 'text-[var(--accent)]'
															: 'text-[var(--text-3)]'
												}`}
											>
												{rel.text}
											</span>
										</li>
									);
								})}
							</ul>
						) : data ? (
							<p className="text-sm text-[var(--text-2)]">
								Kein Putzplan aktiv. Lege einen Putzdienst an.
							</p>
						) : (
							<ChoreSkeleton />
						)}
					</Panel>
				</section>
			</div>
		</>
	);
}

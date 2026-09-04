'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { readResponseErrorCode } from '@/core/guards/settings-errors';
import { SETTINGS_TABS, getSettingsTabFromHash } from '@/core/guards/settings-tabs';
import type { SettingsTab } from '@/core/guards/settings-tabs';
import { type WgExport, buildEmptyExportSummary, buildExportSummary } from '@/core/reads/export';
import { memberAuthHeader } from '@/shared/lib/identity';
import { ArrowLeft, Monitor } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Only one tab is ever mounted, but statically importing all four put every
 * one of them in this route's first-load bundle — it was the heaviest route in
 * the app at 63.6 kB against a 55 kB budget, ~10 kB clear of the next page.
 * Loading each on demand means a visitor pays for the tab they opened.
 *
 * ssr:false because this page is already a client component behind a resolved
 * local identity; there is no server render of these panels to preserve.
 */
const tabFallback = () => <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elev-1)]" />;

const ProfileTab = dynamic(
	() => import('@/components/wg/einstellungen/ProfileTab').then((m) => m.ProfileTab),
	{ ssr: false, loading: tabFallback },
);
const NotificationSection = dynamic(
	() =>
		import('@/components/wg/einstellungen/NotificationSection').then((m) => m.NotificationSection),
	{ ssr: false, loading: tabFallback },
);
const AccessTab = dynamic(
	() => import('@/components/wg/einstellungen/AccessTab').then((m) => m.AccessTab),
	{ ssr: false, loading: tabFallback },
);
const DataTab = dynamic(
	() => import('@/components/wg/einstellungen/DataTab').then((m) => m.DataTab),
	{ ssr: false, loading: tabFallback },
);

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function EinstellungenPage() {
	const { wg, members, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [exportSummary, setExportSummary] =
		useState<ReturnType<typeof buildExportSummary>>(buildEmptyExportSummary);
	const [exportSummaryError, setExportSummaryError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
		typeof window === 'undefined' ? 'profile' : getSettingsTabFromHash(window.location.hash),
	);

	// Load the export summary eagerly on mount, independent of the active tab, so
	// the Daten tab shows section counts the instant it is opened. Kept in the
	// page (always mounted) rather than DataTab (conditionally rendered) so the
	// fetch fires on first paint regardless of which tab is active.
	useEffect(() => {
		let cancelled = false;
		async function loadExportSummary(): Promise<void> {
			try {
				const response = await fetch(`/api/wg/${encodedShareCode}/export`, {
					headers: memberAuthHeader(identity.memberId),
				});
				if (cancelled) return;
				if (!response.ok) {
					setExportSummaryError(
						getWgLoadErrorMessage(
							'Export-Zusammenfassung',
							response.status,
							await readResponseErrorCode(response),
						),
					);
					return;
				}
				setExportSummary(buildExportSummary((await response.json()) as WgExport));
				setExportSummaryError(null);
			} catch {
				if (!cancelled) {
					setExportSummaryError(
						getWgLoadErrorMessage('Export-Zusammenfassung', 0, 'Netzwerkfehler'),
					);
				}
			}
		}
		void loadExportSummary();
		return () => {
			cancelled = true;
		};
	}, [encodedShareCode, identity.memberId]);

	useEffect(() => {
		const update = () => setActiveTab(getSettingsTabFromHash(window.location.hash));
		window.addEventListener('hashchange', update);
		update();
		return () => window.removeEventListener('hashchange', update);
	}, []);

	return (
		<div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
			{/* Back button with safe-area-inset-top awareness handled by parent shell;
			    header matches dashboard h1 size (26px/semibold/tight tracking) */}
			<header className="mb-8 flex items-center gap-3">
				<Link
					href={wgBaseHref}
					aria-label="Zurück zum Dashboard"
					className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<ArrowLeft className="h-4 w-4" aria-hidden />
				</Link>
				<h1 className="min-w-0 truncate text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
					Einstellungen
				</h1>
			</header>

			<div className="space-y-8">
				<div
					role="tablist"
					aria-label="Einstellungen-Bereiche"
					onKeyDown={(event) => {
						const total = SETTINGS_TABS.length;
						const currentIdx = SETTINGS_TABS.findIndex((t) => t.id === activeTab);
						let nextIdx: number | null = null;
						if (event.key === 'ArrowRight') nextIdx = (currentIdx + 1) % total;
						else if (event.key === 'ArrowLeft')
							nextIdx = currentIdx === 0 ? total - 1 : currentIdx - 1;
						else if (event.key === 'Home') nextIdx = 0;
						else if (event.key === 'End') nextIdx = total - 1;
						if (nextIdx === null) return;
						event.preventDefault();
						const target = SETTINGS_TABS[nextIdx];
						if (!target) return;
						window.history.replaceState(null, '', target.hash);
						setActiveTab(target.id);
						requestAnimationFrame(() => {
							document.getElementById(`tab-${target.id}`)?.focus();
						});
					}}
					className="sticky z-10 grid grid-cols-2 gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-1 shadow-sm sm:flex sm:gap-2"
					style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
				>
					{SETTINGS_TABS.map((tab) => {
						const isActive = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								id={`tab-${tab.id}`}
								type="button"
								role="tab"
								aria-selected={isActive}
								aria-controls="settings-panel"
								tabIndex={isActive ? 0 : -1}
								onClick={() => {
									window.history.replaceState(null, '', tab.hash);
									setActiveTab(tab.id);
								}}
								className={`h-11 w-full rounded-md px-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:w-auto sm:shrink-0 sm:px-3 ${
									isActive
										? 'bg-[var(--text-1)] text-[var(--bg-base)]'
										: 'text-[var(--text-2)] hover:bg-[var(--surface)] hover:text-[var(--text-1)]'
								}`}
							>
								{tab.label}
							</button>
						);
					})}
				</div>

				<div
					id="settings-panel"
					role="tabpanel"
					aria-labelledby={`tab-${activeTab}`}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA Tabs Pattern — a tabpanel without inherently focusable children should be focusable (tabIndex={0}) so keyboard users can reach its content.
					tabIndex={0}
					className="space-y-8 outline-none"
				>
					{activeTab === 'profile' && (
						<ProfileTab
							memberName={identity.name}
							wgName={wg.name}
							shareCode={wg.shareCode}
							memberId={identity.memberId}
							memberToken={identity.memberToken}
						/>
					)}

					{activeTab === 'notifications' && (
						<NotificationSection
							code={wg.shareCode}
							memberId={identity.memberId}
							memberToken={identity.memberToken}
						/>
					)}

					{activeTab === 'access' && <AccessTab wg={wg} members={members} identity={identity} />}

					{activeTab === 'data' && (
						<DataTab
							wg={wg}
							identity={identity}
							exportSummary={exportSummary}
							exportSummaryError={exportSummaryError}
						/>
					)}

					<div className="pt-2 text-center text-[11.5px] text-[var(--text-3)]">
						<p>
							ManaWG · WG-Code <span className="font-mono">{wg.shareCode}</span>
						</p>
						<p className="mt-0.5">
							<span className="inline-flex items-center gap-1">
								<Monitor className="h-3 w-3" aria-hidden /> WG-Daten und Mitgliedschaft liegen im
								Account · Nicht synchronisierte Entwürfe und Offline-Aktionen bleiben auf diesem
								Gerät
							</span>
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

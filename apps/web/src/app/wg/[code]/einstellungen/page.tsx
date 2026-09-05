'use client';

import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { readResponseErrorCode } from '@/core/guards/settings-errors';
import { SETTINGS_TABS, getSettingsTabFromHash } from '@/core/guards/settings-tabs';
import type { SettingsTab } from '@/core/guards/settings-tabs';
import { type WgExport, buildEmptyExportSummary, buildExportSummary } from '@/core/reads/export';
import { cn } from '@/shared/lib/cn';
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
const tabFallback = () => <Skeleton className="h-40 w-full" />;

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
		<div className="mx-auto w-full max-w-md px-4 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
			<div className="py-6">
				<header className="mb-6 flex items-center gap-2">
					<Link
						href={wgBaseHref}
						aria-label="Zurück zum Dashboard"
						className={cn(
							buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
							'min-h-11 min-w-11 shrink-0',
						)}
					>
						<ArrowLeft aria-hidden />
						<span className="sr-only">Zurück zum Dashboard</span>
					</Link>
					<h1 className="text-foreground min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
						Einstellungen
					</h1>
				</header>

				<Tabs
					value={activeTab}
					onValueChange={(next) => {
						const tabId = next as SettingsTab;
						const target = SETTINGS_TABS.find((t) => t.id === tabId);
						if (target) window.history.replaceState(null, '', target.hash);
						setActiveTab(tabId);
					}}
				>
					<TabsList
						className="sticky z-10 grid w-full grid-cols-2 gap-1 p-1"
						style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
					>
						{SETTINGS_TABS.map((tab) => (
							<TabsTrigger
								key={tab.id}
								value={tab.id}
								id={`tab-${tab.id}`}
								className="min-h-[44px] w-full text-xs"
							>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>

					<TabsContent value={activeTab} className="mt-6 grid gap-6 outline-none">
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

						<div className="text-muted-foreground pt-2 text-center text-xs">
							<p>
								ManaWG · WG-Code <span className="font-mono">{wg.shareCode}</span>
							</p>
							<p className="mt-0.5">
								<span className="inline-flex items-center gap-1">
									<Monitor className="h-3 w-3" aria-hidden /> Daten lokal an Gerät gebunden
								</span>
							</p>
						</div>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}

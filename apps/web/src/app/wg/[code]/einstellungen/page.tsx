'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWg } from '@/components/wg/WgContextProvider';
import { readResponseErrorCode } from '@/components/wg/einstellungen/settings-errors';
import {
	type ExportSectionCounts,
	buildEmptyExportSummary,
	buildExportSummaryFromCounts,
} from '@/composition/export';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { SETTINGS_TABS, getSettingsTabFromHash } from '@/core/guards/settings-tabs';
import type { SettingsTab } from '@/core/guards/settings-tabs';
import { memberContextHeader } from '@/core/auth/identity';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

/**
 * Only one tab is ever mounted, but statically importing all four put every
 * one of them in this route's first-load bundle — it was the heaviest route in
 * the app at 63.6 kB against a 55 kB budget, ~10 kB clear of the next page.
 * Loading each on demand means a visitor pays for the tab they opened.
 *
 * ssr:false because this page is already a client component behind a resolved
 * local identity; there is no server render of these panels to preserve.
 */
// Ahmt Titelzeile plus Karte nach, damit der Tab-Inhalt kaum springt.
const tabFallback = () => (
	<div className="grid gap-2.5" aria-hidden>
		{[0, 1, 2].map((i) => (
			<div key={i} className="grid gap-1">
				<Skeleton className="h-3 w-24" />
				<Skeleton className="h-32 w-full rounded-xl" />
			</div>
		))}
	</div>
);

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

export default function EinstellungenPage() {
	const { wg, members, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const [exportSummary, setExportSummary] =
		useState<ReturnType<typeof buildExportSummaryFromCounts>>(buildEmptyExportSummary);
	const [exportSummaryError, setExportSummaryError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
		typeof window === 'undefined' ? 'profile' : getSettingsTabFromHash(window.location.hash),
	);

	// Tab-Chunks vorladen: offline schlägt sonst jeder Tab-Wechsel fehl und der Import bleibt gecacht.
	useEffect(() => {
		void import('@/components/wg/einstellungen/ProfileTab');
		void import('@/components/wg/einstellungen/NotificationSection');
		void import('@/components/wg/einstellungen/AccessTab');
		void import('@/components/wg/einstellungen/DataTab');
	}, []);

	// Export-Zusammenfassung erst laden, wenn der Daten-Tab geöffnet wird; danach bleibt sie im State.
	const exportSummaryLoaded = useRef(false);
	useEffect(() => {
		if (activeTab !== 'data' || exportSummaryLoaded.current) return;
		let cancelled = false;
		async function loadExportSummary(): Promise<void> {
			try {
				const response = await fetch(`/api/wg/${encodedShareCode}/export?summary=counts`, {
					headers: memberContextHeader(identity.memberId),
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
				const { counts } = (await response.json()) as { counts: ExportSectionCounts };
				setExportSummary(buildExportSummaryFromCounts(counts));
				setExportSummaryError(null);
				exportSummaryLoaded.current = true;
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
	}, [activeTab, encodedShareCode, identity.memberId]);

	// Nach dem Tab-Wechsel zum Anfang des neuen Inhalts, nicht mitten hinein (das Scroll-Padding hält die Leiste frei).
	const previousTab = useRef(activeTab);
	useEffect(() => {
		if (previousTab.current === activeTab) return;
		previousTab.current = activeTab;
		const frame = requestAnimationFrame(() => {
			const strip = document.querySelector<HTMLElement>('[data-sticky-tabs]');
			const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
			if (!strip || !panel) return;
			if (panel.getBoundingClientRect().top < strip.getBoundingClientRect().bottom)
				panel.scrollIntoView({ block: 'start' });
		});
		return () => cancelAnimationFrame(frame);
	}, [activeTab]);

	useEffect(() => {
		const update = () => setActiveTab(getSettingsTabFromHash(window.location.hash));
		window.addEventListener('hashchange', update);
		update();
		return () => window.removeEventListener('hashchange', update);
	}, []);

	// WCAG 2.4.11: measure the sticky tab strip so the scroll-padding rule in
	// globals.css (html:has([data-sticky-tabs])) clears exactly its height,
	// including when text scaling wraps it onto a second line.
	useEffect(() => {
		const tabsList = document.querySelector<HTMLElement>('[data-sticky-tabs]');
		if (!tabsList) return;
		const setHeight = () => {
			document.documentElement.style.setProperty(
				'--settings-tabs-height',
				`${tabsList.getBoundingClientRect().height}px`,
			);
		};
		setHeight();
		const observer = new ResizeObserver(setHeight);
		observer.observe(tabsList);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			data-household-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<h1 className="font-heading min-w-0 flex-1 text-base font-semibold tracking-tight break-words text-foreground">
				Einstellungen
			</h1>
			<div className="min-w-0">
				<Tabs
					className="min-w-0"
					value={activeTab}
					onValueChange={(next) => {
						const tabId = next as SettingsTab;
						const target = SETTINGS_TABS.find((t) => t.id === tabId);
						if (target) window.history.replaceState(null, '', target.hash);
						setActiveTab(tabId);
					}}
				>
					<TabsList
						data-sticky-tabs
						className="sticky z-20 flex flex-wrap before:absolute before:-inset-x-4 before:-top-[calc(env(safe-area-inset-top,0px)+var(--offline-banner-height,0px)+0.5rem)] before:h-[calc(env(safe-area-inset-top,0px)+var(--offline-banner-height,0px)+0.5rem)] before:bg-background before:content-[''] h-auto min-w-0 max-w-full w-full gap-1 rounded-xl p-1"
						style={{
							top: 'calc(env(safe-area-inset-top, 0px) + var(--offline-banner-height, 0px) + 0.5rem)',
						}}
					>
						{SETTINGS_TABS.map((tab) => (
							<TabsTrigger
								key={tab.id}
								value={tab.id}
								id={`tab-${tab.id}`}
								className="min-w-fit flex-[1_1_auto] px-1 text-center text-xs [overflow-wrap:normal]"
							>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>

					<TabsContent
						value={activeTab}
						className="mt-2 grid min-w-0 max-w-full gap-2.5 outline-none"
					>
						{activeTab === 'profile' && (
							<ProfileTab
								memberName={identity.name}
								wgName={wg.name}
								shareCode={wg.shareCode}
								memberId={identity.memberId}
							/>
						)}

						{activeTab === 'notifications' && (
							<NotificationSection code={wg.shareCode} memberId={identity.memberId} />
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
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}

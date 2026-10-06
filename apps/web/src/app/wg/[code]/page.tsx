'use client';

import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import dynamic from 'next/dynamic';
import { ForYouSection } from './_components/ForYouSection';
import { StartWelcome } from './_components/StartWelcome';
import { WeekSection } from './_components/WeekSection';
import { WgNewsSection } from './_components/WgNewsSection';
import { useHomeChoreCompletion } from './_hooks/use-home-chore-completion';
import { useHomeData } from './_hooks/use-home-data';
import { useHomeView } from './_hooks/use-home-view';

const PushPrimingPrompt = dynamic(
	() => import('@/components/app/PushPrimingPrompt').then((m) => m.PushPrimingPrompt),
	{ ssr: false },
);

export default function WgHomePage() {
	const { wg, identity, members } = useWg();
	const wgBaseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	const home = useHomeData(wg.shareCode, identity);
	const { data, error, eventRead } = home;
	const completion = useHomeChoreCompletion({ wg, identity, members, reload: home.load });
	const view = useHomeView({
		data,
		eventOccurrences: home.eventOccurrences,
		agendaNow: home.agendaNow,
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		memberName: identity.name,
		queuedOccurrences: completion.queuedOccurrences,
	});

	return (
		<div
			data-home-content
			className="mx-auto flex w-full min-w-0 max-w-[var(--app-frame-width)] flex-col gap-3 px-4 py-3"
		>
			{view.isNewWg && (
				<div>
					<StartWelcome />
				</div>
			)}
			{/* Offline with data on screen: the offline bar already says so. */}
			{error && !(data && !home.online) && (
				<div>
					<LoadErrorBanner
						message={data ? `${error} Die angezeigten Daten können veraltet sein.` : error}
						onRetry={() => void home.load()}
						busy={home.loading}
						retryLabel="Startseite erneut laden"
					/>
				</div>
			)}

			{!view.isNewWg && (
				<ForYouSection
					items={view.forYouItems}
					loaded={Boolean(data)}
					failed={Boolean(error)}
					completion={completion}
				/>
			)}

			<div className="flex min-w-0 flex-col gap-3">
				<WeekSection
					wgBaseHref={wgBaseHref}
					agenda={view.weekAgenda}
					todayKey={home.berlinTodayKey}
					online={home.online}
					events={{
						loading: eventRead.isLoading,
						loaded: Boolean(eventRead.data),
						failed: Boolean(eventRead.error),
						retry: () => void eventRead.refresh(),
					}}
					choresLoaded={Boolean(data)}
					choresFailed={Boolean(error)}
				/>
				<WgNewsSection
					shareCode={wg.shareCode}
					wgBaseHref={wgBaseHref}
					loaded={Boolean(data)}
					failed={Boolean(error)}
					latestAnnouncement={view.latestAnnouncement}
					latestIsPending={view.latestIsPending}
					activityItems={view.activityItems}
				/>
			</div>
			<div>
				<PushPrimingPrompt code={wg.shareCode} memberId={identity.memberId} />
			</div>
		</div>
	);
}

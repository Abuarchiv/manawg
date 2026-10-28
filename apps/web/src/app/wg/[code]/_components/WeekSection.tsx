'use client';

import { CalendarDays, ChevronRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import type { WeekAgenda, WeekAgendaItem } from '@/composition/dashboard-insights';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { MS_PER_DAY } from '@/core/utils/time';
import { cn } from '@/shared/lib/cn';

const AGENDA_VISIBLE = 4;

const AGENDA_DAY_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	timeZone: 'Europe/Berlin',
});

function formatAgendaDay(dayKey: string, todayKey: string): string {
	if (dayKey === todayKey) return 'Heute';
	const tomorrowKey = berlinDayKey(new Date(Date.parse(`${todayKey}T12:00:00Z`) + MS_PER_DAY));
	if (dayKey === tomorrowKey) return 'Morgen';
	return AGENDA_DAY_FORMATTER.format(new Date(`${dayKey}T12:00:00.000Z`));
}

function AgendaRow({ item, todayKey }: { item: WeekAgendaItem; todayKey: string }) {
	return (
		<li className="flex min-w-0 items-center gap-2 pl-2 pr-2">
			<span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
				{item.kind === 'event' ? (
					<CalendarDays className="size-4" aria-hidden />
				) : (
					<Sparkles className="size-4" aria-hidden />
				)}
			</span>
			<Link
				href={item.href}
				className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="text-body font-medium leading-snug break-words">{item.title}</span>
					<span className="text-meta text-muted-foreground">
						{formatAgendaDay(item.dayKey, todayKey)} · {item.detail}
					</span>
				</span>
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</Link>
		</li>
	);
}

function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<Link
			href={href}
			className={cn(
				buttonVariants({ variant: 'ghost' }),
				'w-full justify-between text-muted-foreground',
			)}
		>
			<span>{children}</span>
			<ChevronRight data-icon="inline-end" aria-hidden />
		</Link>
	);
}

interface WeekSectionProps {
	wgBaseHref: string;
	agenda: WeekAgenda;
	todayKey: string;
	online: boolean;
	events: { loading: boolean; loaded: boolean; failed: boolean; retry: () => void };
	/** Dashboard read state: chores come from it, events from their own read. */
	choresLoaded: boolean;
	choresFailed: boolean;
}

export function WeekSection({
	wgBaseHref,
	agenda,
	todayKey,
	online,
	events,
	choresLoaded,
	choresFailed,
}: WeekSectionProps) {
	const overdueVisible = agenda.overdue.slice(0, AGENDA_VISIBLE);
	const upcomingVisible = agenda.upcoming.slice(0, AGENDA_VISIBLE);
	return (
		<section aria-labelledby="week-heading" className="flex min-w-0 flex-col gap-2">
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				<h2
					id="week-heading"
					tabIndex={-1}
					className="font-heading min-w-0 text-xl font-semibold outline-none"
				>
					Diese Woche
				</h2>
				<Link
					href={`${wgBaseHref}/kalender`}
					className={cn(
						buttonVariants({ variant: 'ghost' }),
						'ml-auto shrink-0 px-2 text-sm text-muted-foreground after:h-[44px] after:min-w-[44px]',
					)}
				>
					Kalender <ChevronRight data-icon="inline-end" aria-hidden />
				</Link>
			</div>

			{((events.loading && !events.loaded) || (!choresLoaded && !choresFailed)) && (
				<div
					className="flex min-w-0 flex-col gap-2"
					aria-label="Termine und Putzplan-Aufgaben werden geladen"
					// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
					role="status"
				>
					<Skeleton className="h-11 w-full bg-foreground/[0.07]" />
					<Skeleton className="h-11 w-full bg-foreground/[0.07]" />
				</div>
			)}

			{events.failed && !(online === false && events.loaded) && (
				<LoadErrorBanner
					message={
						events.loaded
							? 'Termine konnten nicht aktualisiert werden. Angezeigte Einträge können veraltet sein.'
							: choresLoaded
								? 'Termine konnten nicht geladen werden. Putzplan-Aufgaben bleiben sichtbar.'
								: 'Termine konnten nicht geladen werden.'
					}
					onRetry={events.retry}
					busy={events.loading}
					retryLabel="Termine erneut laden"
				/>
			)}

			{!choresLoaded && choresFailed && (
				<p className="text-sm text-muted-foreground">
					Putzplan-Aufgaben konnten nicht geladen werden.
				</p>
			)}

			{agenda.overdue.length > 0 && (
				<div className="flex min-w-0 flex-col gap-2">
					<h3 className="text-sm font-medium text-foreground">Überfällig</h3>
					<ul className="flex min-w-0 flex-col divide-y divide-border/60 rounded-xl border">
						{overdueVisible.map((item) => (
							<AgendaRow key={item.key} item={item} todayKey={todayKey} />
						))}
					</ul>
					{agenda.overdue.length > overdueVisible.length && (
						<MoreLink href={`${wgBaseHref}/putzen?filter=overdue`}>
							Alle {agenda.overdue.length} überfälligen Aufgaben
						</MoreLink>
					)}
				</div>
			)}

			{upcomingVisible.length > 0 && (
				<div className="flex min-w-0 flex-col gap-2">
					{agenda.overdue.length > 0 && (
						<h3 className="text-sm font-medium text-muted-foreground">Anstehend</h3>
					)}
					<ul className="flex min-w-0 flex-col divide-y divide-border/60 rounded-xl border">
						{upcomingVisible.map((item) => (
							<AgendaRow key={item.key} item={item} todayKey={todayKey} />
						))}
					</ul>
					{agenda.upcoming.length > upcomingVisible.length && (
						<MoreLink href={`${wgBaseHref}/kalender`}>
							{agenda.upcoming.length - upcomingVisible.length === 1
								? 'Ein weiterer Termin oder eine Aufgabe'
								: `${agenda.upcoming.length - upcomingVisible.length} weitere Termine und Aufgaben`}
						</MoreLink>
					)}
				</div>
			)}

			{choresLoaded &&
				!choresFailed &&
				!events.failed &&
				events.loaded &&
				agenda.overdue.length === 0 &&
				agenda.upcoming.length === 0 && (
					<p className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground">
						<CalendarDays className="size-4 shrink-0" aria-hidden />
						Bis Sonntag nichts geplant.
					</p>
				)}
		</section>
	);
}

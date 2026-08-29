'use client';

import { apiFetch } from '@/core/infra/api-client';
import { MS_PER_DAY } from '@/core/utils/time';
import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface KalenderEvent {
	id: string;
	title: string;
	startsAt: string;
	allDay: boolean;
}

interface KalenderResponse {
	events: KalenderEvent[];
}

interface Props {
	shareCode: string;
	memberId: string;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

const RANGE_DAYS = 7;
const MAX_DISPLAY_EVENTS = 3;

function formatEventDate(iso: string, allDay: boolean): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '–';
	if (allDay) {
		return new Intl.DateTimeFormat('de-DE', {
			weekday: 'short',
			day: '2-digit',
			month: '2-digit',
		}).format(date);
	}
	return new Intl.DateTimeFormat('de-DE', {
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);
}

export function KalenderCard({ shareCode, memberId }: Props) {
	const encoded = encodeURIComponent(shareCode);
	const href = `/wg/${encoded}/kalender`;
	const [state, setState] = useState<LoadState>('loading');
	const [events, setEvents] = useState<KalenderEvent[]>([]);

	useEffect(() => {
		const controller = new AbortController();
		const from = new Date().toISOString();
		const to = new Date(Date.now() + RANGE_DAYS * MS_PER_DAY).toISOString();
		const url = `/api/wg/${encoded}/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

		apiFetch<KalenderResponse>(url, { memberId, signal: controller.signal }).then((result) => {
			if (controller.signal.aborted) return;
			if (!result.ok) {
				if (result.status === 404) {
					setState('unavailable');
				} else {
					setState('ready');
					setEvents([]);
				}
				return;
			}
			setEvents(Array.isArray(result.data?.events) ? result.data.events : []);
			setState('ready');
		});

		return () => controller.abort();
	}, [encoded, memberId]);

	return (
		<Link
			href={href}
			className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color,background-color] duration-150 hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
		>
			<header className="flex items-center gap-2">
				<CalendarDays
					className="h-4 w-4 shrink-0 text-[var(--text-3)]"
					strokeWidth={1.75}
					aria-hidden
				/>
				<h2 className="text-[13px] font-medium text-[var(--text-2)]">Kalender</h2>
			</header>
			<div className="mt-3 flex-1 text-[13px] text-[var(--text-1)]">
				{state === 'loading' && <p className="text-[12.5px] text-[var(--text-3)]">Lädt Termine…</p>}
				{state === 'unavailable' && (
					<p className="text-[12.5px] text-[var(--text-3)]">Feature kommt bald</p>
				)}
				{state === 'ready' && events.length === 0 && (
					<p className="text-[12.5px] text-[var(--text-3)]">Noch keine Termine</p>
				)}
				{state === 'ready' && events.length > 0 && (
					<ul className="space-y-1.5">
						{events.slice(0, MAX_DISPLAY_EVENTS).map((event) => (
							<li key={event.id} className="flex justify-between gap-2">
								<span className="truncate" title={event.title}>
									{event.title}
								</span>
								<span className="shrink-0 text-[12px] tabular-nums text-[var(--text-3)]">
									{formatEventDate(event.startsAt, event.allDay)}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</Link>
	);
}

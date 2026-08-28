'use client';

import { formatEuroCents } from '@/lib/money';
import { RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface RecurringExpense {
	id: string;
	description: string;
	amount_cents: number;
	next_due_at: string;
}

interface RecurringResponse {
	recurring?: RecurringExpense[];
	recurringExpenses?: Array<{
		id: string;
		description: string;
		amountCents: number;
		nextDueAt: string;
	}>;
}

interface Props {
	shareCode: string;
	memberId: string;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

const MAX_DISPLAY_RECURRING = 3;

function formatNextDueDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '–';
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
	}).format(date);
}

function normalizeRecurring(body: RecurringResponse): RecurringExpense[] {
	if (Array.isArray(body.recurring)) return body.recurring;
	if (Array.isArray(body.recurringExpenses)) {
		return body.recurringExpenses.map((entry) => ({
			id: entry.id,
			description: entry.description,
			amount_cents: entry.amountCents,
			next_due_at: entry.nextDueAt,
		}));
	}
	return [];
}

export function AbosCard({ shareCode, memberId }: Props) {
	const encoded = encodeURIComponent(shareCode);
	const href = `/wg/${encoded}/abos`;
	const [state, setState] = useState<LoadState>('loading');
	const [recurring, setRecurring] = useState<RecurringExpense[]>([]);

	useEffect(() => {
		const controller = new AbortController();
		const url = `/api/wg/${encoded}/recurring-expenses?upcoming=${MAX_DISPLAY_RECURRING}`;

		fetch(url, {
			signal: controller.signal,
			cache: 'no-store',
			headers: { 'x-manawg-member-id': memberId },
		})
			.then(async (res) => {
				if (res.status === 404) {
					setState('unavailable');
					return;
				}
				if (!res.ok) {
					setState('ready');
					setRecurring([]);
					return;
				}
				try {
					const body = (await res.json()) as RecurringResponse;
					setRecurring(normalizeRecurring(body));
					setState('ready');
				} catch {
					setState('ready');
					setRecurring([]);
				}
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				setState('ready');
				setRecurring([]);
			});

		return () => controller.abort();
	}, [encoded, memberId]);

	return (
		<Link
			href={href}
			className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color,background-color] duration-150 hover:-translate-y-px hover:border-[var(--border-strong)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
		>
			<header className="flex items-center gap-2">
				<RefreshCcw
					className="h-4 w-4 shrink-0 text-[var(--text-3)]"
					strokeWidth={1.75}
					aria-hidden
				/>
				<h2 className="text-[13px] font-medium text-[var(--text-2)]">Abos</h2>
			</header>
			<div className="mt-3 flex-1 text-[13px] text-[var(--text-1)]">
				{state === 'loading' && <p className="text-[12.5px] text-[var(--text-3)]">Lädt Abos…</p>}
				{state === 'unavailable' && (
					<p className="text-[12.5px] text-[var(--text-3)]">Feature kommt bald</p>
				)}
				{state === 'ready' && recurring.length === 0 && (
					<p className="text-[12.5px] text-[var(--text-3)]">Keine aktiven Abos</p>
				)}
				{state === 'ready' && recurring.length > 0 && (
					<ul className="space-y-1.5">
						{recurring.slice(0, MAX_DISPLAY_RECURRING).map((entry) => (
							<li key={entry.id} className="flex justify-between gap-2">
								<span className="truncate">{entry.description}</span>
								<span className="shrink-0 text-[12px] tabular-nums text-[var(--text-3)]">
									{formatEuroCents(entry.amount_cents)} · {formatNextDueDate(entry.next_due_at)}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</Link>
	);
}

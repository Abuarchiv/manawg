'use client';

import { formatEuroCents } from '@/core/utils/money';
import { BellRing } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Balance {
	debtor_id: string;
	debtor_name: string;
	amount_cents: number;
	oldest_age_days: number;
}

interface BalancesResponse {
	balances: Balance[];
}

interface Props {
	shareCode: string;
	memberId: string;
}

type LoadState = 'loading' | 'ready' | 'unavailable';
type RemindState = 'idle' | 'sending' | 'sent' | 'error';

const MAX_DISPLAY_BALANCES = 3;

export function MahnungenCard({ shareCode, memberId }: Props) {
	const encoded = encodeURIComponent(shareCode);
	const href = `/wg/${encoded}/mahnungen`;
	const [state, setState] = useState<LoadState>('loading');
	const [balances, setBalances] = useState<Balance[]>([]);
	const [reminders, setReminders] = useState<Record<string, RemindState>>({});

	useEffect(() => {
		const controller = new AbortController();
		const url = `/api/wg/${encoded}/reminders/balances`;

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
					setBalances([]);
					return;
				}
				try {
					const body = (await res.json()) as BalancesResponse;
					setBalances(Array.isArray(body.balances) ? body.balances : []);
					setState('ready');
				} catch {
					setState('ready');
					setBalances([]);
				}
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				setState('ready');
				setBalances([]);
			});

		return () => controller.abort();
	}, [encoded, memberId]);

	async function handleRemind(debtorId: string): Promise<void> {
		setReminders((prev) => ({ ...prev, [debtorId]: 'sending' }));
		try {
			const res = await fetch(`/api/wg/${encoded}/reminders`, {
				method: 'POST',
				cache: 'no-store',
				headers: {
					'content-type': 'application/json',
					'x-manawg-member-id': memberId,
				},
				body: JSON.stringify({ debtorMemberId: debtorId, creditorMemberId: memberId }),
			});
			setReminders((prev) => ({
				...prev,
				[debtorId]: res.ok ? 'sent' : 'error',
			}));
		} catch {
			setReminders((prev) => ({ ...prev, [debtorId]: 'error' }));
		}
	}

	function reminderLabel(remindState: RemindState | undefined): string {
		if (remindState === 'sending') return 'sendet…';
		if (remindState === 'sent') return 'gesendet';
		if (remindState === 'error') return 'fehlgeschlagen';
		return 'Mahnen';
	}

	return (
		<div className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color] hover:border-[var(--border-strong)]">
			<header className="flex items-center justify-between gap-2">
				<Link
					href={href}
					className="flex items-center gap-2 transition-colors hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<BellRing
						className="h-4 w-4 shrink-0 text-[var(--text-3)]"
						strokeWidth={1.75}
						aria-hidden
					/>
					<h2 className="text-[13px] font-medium text-[var(--text-2)]">Mahnungen</h2>
				</Link>
			</header>
			<div className="mt-3 flex-1 text-[13px] text-[var(--text-1)]">
				{state === 'loading' && (
					<p className="text-[12.5px] text-[var(--text-3)]">Lädt offene Forderungen…</p>
				)}
				{state === 'unavailable' && (
					<p className="text-[12.5px] text-[var(--text-3)]">Feature kommt bald</p>
				)}
				{state === 'ready' && balances.length === 0 && (
					<p className="text-[12.5px] text-[var(--text-3)]">Alles ausgeglichen 🎉</p>
				)}
				{state === 'ready' && balances.length > 0 && (
					<ul className="space-y-2">
						{balances.slice(0, MAX_DISPLAY_BALANCES).map((entry, index) => {
							const debtorKey = entry.debtor_id ?? `row-${index}`;
							const remindState = reminders[debtorKey];
							const disabled = remindState === 'sending' || remindState === 'sent';
							return (
								<li
									key={debtorKey}
									className="flex items-center justify-between gap-2 text-[12.5px]"
								>
									<div className="min-w-0">
										<p className="truncate text-[var(--text-1)]">{entry.debtor_name}</p>
										<p className="text-[11.5px] text-[var(--text-3)]">
											{formatEuroCents(entry.amount_cents)} · {entry.oldest_age_days} T.
										</p>
									</div>
									<button
										type="button"
										onClick={() => void handleRemind(entry.debtor_id ?? debtorKey)}
										disabled={disabled}
										aria-busy={remindState === 'sending'}
										aria-live="polite"
										aria-label={`${reminderLabel(remindState)}: ${entry.debtor_name}, ${formatEuroCents(entry.amount_cents)}`}
										className="inline-flex h-11 shrink-0 items-center rounded-md border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{reminderLabel(remindState)}
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}

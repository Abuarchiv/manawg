import { formatEuroCents } from '@/core/utils/money';
import Link from 'next/link';
import { MemberAvatar } from './MemberAvatar';

interface BalanceRow {
	memberId: string;
	memberName: string;
	color: string | null;
	balanceCents: number;
}

interface BalanceBarsProps {
	balances: BalanceRow[];
	currentMemberId: string;
	emptyHref?: string;
}

export function BalanceBars({ balances, currentMemberId, emptyHref }: BalanceBarsProps) {
	if (balances.length === 0) {
		return (
			<div className="space-y-2">
				<p className="text-sm text-[var(--text-2)]">
					Noch keine Ausgaben — sobald jemand etwas einträgt, erscheint hier der Saldo.
				</p>
				{emptyHref && (
					<Link
						href={emptyHref}
						className="inline-flex h-11 items-center rounded-md border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						Erste Ausgabe eintragen
					</Link>
				)}
			</div>
		);
	}

	const sorted = [...balances].sort((a, b) => b.balanceCents - a.balanceCents);

	return (
		<ul className="divide-y divide-[var(--border)]">
			{sorted.map((b) => {
				const isMe = b.memberId === currentMemberId;
				const positive = b.balanceCents > 0;
				const zero = b.balanceCents === 0;

				return (
					<li
						key={b.memberId}
						className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
					>
						<div className="flex min-w-0 items-center gap-2.5">
							<MemberAvatar name={b.memberName} color={b.color} size={24} />
							<span className="truncate text-sm text-[var(--text-1)]">
								{b.memberName}
								{isMe && <span className="ml-1 text-[var(--text-3)]">(du)</span>}
							</span>
						</div>
						<span
							className={`shrink-0 whitespace-nowrap text-sm tabular-nums ${
								zero
									? 'text-[var(--text-3)]'
									: positive
										? 'font-medium text-[var(--accent)]'
										: 'font-medium text-[var(--danger)]'
							}`}
						>
							<span className="sr-only">
								{zero ? 'ausgeglichen' : positive ? 'erhält' : 'schuldet'}{' '}
							</span>
							{formatEuroCents(b.balanceCents, 'EUR', { signed: positive })}
						</span>
					</li>
				);
			})}
		</ul>
	);
}

'use client';

import { AboPausedBadge } from '@/components/wg/AboPausedBadge';
import { ProviderIcon } from '@/components/wg/ProviderIcon';
import type { Abo, MemberOption } from '@/components/wg/abos-types';
import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate } from '@/core/utils/time';
import {
	detectProvider,
	formatIntervalLabel,
	previewNextOccurrences,
} from '@/features/expenses/recurring-expenses';
import { Loader2, Pause, Pencil, Play, Trash2 } from 'lucide-react';

const PREVIEW_COUNT = 3;

interface AboRowProps {
	abo: Abo;
	members: MemberOption[];
	pending: boolean;
	onEdit: (abo: Abo) => void;
	onTogglePause: (abo: Abo) => void;
	onDelete: (abo: Abo) => void;
}

function memberLookup(members: MemberOption[], id: string): MemberOption | null {
	return members.find((member) => member.id === id) ?? null;
}

export function AboRow({ abo, members, pending, onEdit, onTogglePause, onDelete }: AboRowProps) {
	const provider = detectProvider(abo.description);
	const payer = memberLookup(members, abo.paidByMemberId);
	const isPaused = abo.pausedAt !== null;
	const preview = previewNextOccurrences(
		{ nextDueAt: abo.nextDueAt, intervalMonths: abo.intervalMonths },
		PREVIEW_COUNT,
	);

	return (
		<li className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4">
			<div className="flex items-start gap-3">
				<ProviderIcon provider={provider} size={36} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<h3
							className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-[var(--text-1)]"
							title={abo.description}
						>
							{abo.description}
						</h3>
						<span className="shrink-0 text-[14.5px] font-medium tabular-nums text-[var(--text-1)]">
							{formatEuroCents(abo.amountCents)}
						</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
						<span>{formatIntervalLabel(abo.intervalMonths)}</span>
						<span aria-hidden>·</span>
						<span>nächste Fälligkeit: {formatShortDate(abo.nextDueAt)}</span>
						{isPaused && <AboPausedBadge />}
					</div>
					<div className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
						<MemberAvatar name={payer?.name ?? '?'} color={payer?.color ?? null} size={16} />
						<span className="truncate">bezahlt von {payer?.name ?? 'unbekannt'}</span>
					</div>
					{abo.splits.length > 0 && (
						<ul className="mt-2 flex flex-wrap gap-1.5">
							{abo.splits.map((split) => {
								const debtor = memberLookup(members, split.debtorMemberId);
								const debtorName = debtor?.name ?? 'unbekannt';
								return (
									<li
										key={`${abo.id}-${split.debtorMemberId}`}
										aria-label={`${debtorName} schuldet ${formatEuroCents(split.amountCents)}`}
										className="inline-flex items-center gap-1 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--text-2)]"
									>
										<MemberAvatar
											name={debtor?.name ?? '?'}
											color={debtor?.color ?? null}
											size={12}
										/>
										<span aria-hidden="true">{debtorName}</span>
										<span aria-hidden="true" className="tabular-nums">
											{formatEuroCents(split.amountCents)}
										</span>
									</li>
								);
							})}
						</ul>
					)}
					{preview.length > 0 && !isPaused && (
						<p className="mt-2 text-[11.5px] text-[var(--text-3)]">
							Nächste {preview.length} Buchungen:{' '}
							{preview.map((date) => formatShortDate(date.toISOString())).join(', ')}
						</p>
					)}
				</div>
			</div>
			<div className="mt-3 flex flex-wrap justify-end gap-1.5">
				<button
					type="button"
					onClick={() => onTogglePause(abo)}
					disabled={pending}
					aria-label={isPaused ? `${abo.description} reaktivieren` : `${abo.description} pausieren`}
					className="inline-flex h-11 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{pending ? (
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
					) : isPaused ? (
						<Play className="h-4 w-4" aria-hidden />
					) : (
						<Pause className="h-4 w-4" aria-hidden />
					)}
					{isPaused ? 'Reaktivieren' : 'Pausieren'}
				</button>
				<button
					type="button"
					onClick={() => onEdit(abo)}
					disabled={pending}
					aria-label={`${abo.description} bearbeiten`}
					className="inline-flex h-11 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Pencil className="h-4 w-4" aria-hidden /> Bearbeiten
				</button>
				<button
					type="button"
					onClick={() => onDelete(abo)}
					disabled={pending}
					aria-label={`${abo.description} löschen`}
					className="inline-flex h-11 items-center gap-1 rounded-md border border-[var(--danger)]/40 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Trash2 className="h-4 w-4" aria-hidden /> Löschen
				</button>
			</div>
		</li>
	);
}

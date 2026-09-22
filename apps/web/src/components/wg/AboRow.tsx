'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@/components/ui/item';
import { AboPausedBadge } from '@/components/wg/AboPausedBadge';
import type { Abo, MemberOption } from '@/components/wg/abos-types';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate } from '@/core/utils/time';
import {
	formatIntervalLabel,
	previewNextOccurrences,
} from '@/features/expenses/recurring-expenses';
import { ChevronDown, Pause, Pencil, Play, Trash2 } from 'lucide-react';

interface AboRowProps {
	abo: Abo;
	members: MemberOption[];
	pending: boolean;
	onEdit: (abo: Abo) => void;
	onTogglePause: (abo: Abo) => void;
	onDelete: (abo: Abo) => void;
}

export function AboRow({ abo, members, pending, onEdit, onTogglePause, onDelete }: AboRowProps) {
	const payer = members.find((member) => member.id === abo.paidByMemberId);
	const isPaused = abo.pausedAt !== null;
	const preview = previewNextOccurrences(
		{ nextDueAt: abo.nextDueAt, intervalMonths: abo.intervalMonths },
		3,
	);
	return (
		<li>
			<Item variant="outline" className="items-start">
				<ItemContent className="min-w-0">
					<ItemTitle className="line-clamp-none break-words">{abo.description}</ItemTitle>
					<ItemDescription className="line-clamp-none">
						{formatIntervalLabel(abo.intervalMonths)} · nächste Fälligkeit:{' '}
						{formatShortDate(abo.nextDueAt)}
					</ItemDescription>
					<ItemDescription className="line-clamp-none">
						Bezahlt von {payer?.name ?? 'unbekannt'}
					</ItemDescription>
				</ItemContent>
				<div className="flex flex-col items-end gap-2">
					<Badge variant="outline" className="font-mono tabular-nums">
						{formatEuroCents(abo.amountCents, abo.currency)}
					</Badge>
					{isPaused && <AboPausedBadge />}
				</div>
				<ItemFooter className="flex-col items-stretch gap-3">
					<Collapsible>
						<CollapsibleTrigger
							render={<Button variant="ghost" className="min-h-11 w-full justify-between" />}
						>
							Anteile, Termine & Aktionen
							<ChevronDown data-icon="inline-end" />
						</CollapsibleTrigger>
						<CollapsiblePanel>
							<div className="flex flex-col gap-3 py-2">
								<ul className="flex flex-col gap-2">
									{abo.splits.map((split) => {
										const name =
											members.find((member) => member.id === split.debtorMemberId)?.name ??
											'unbekannt';
										return (
											<li
												key={split.debtorMemberId}
												className="flex items-baseline justify-between gap-3 text-sm"
											>
												<span className="min-w-0 break-words">
													{name}
													{split.debtorMemberId === abo.paidByMemberId ? ' · eigener Anteil' : ''}
												</span>
												<span className="shrink-0 font-mono tabular-nums">
													{formatEuroCents(split.amountCents, abo.currency)}
												</span>
											</li>
										);
									})}
								</ul>
								{preview.length > 0 && !isPaused && (
									<p className="text-sm text-muted-foreground">
										Nächste {preview.length} Buchungen:{' '}
										{preview.map((date) => formatShortDate(date.toISOString())).join(', ')}
									</p>
								)}
								<div className="flex flex-wrap items-center gap-2 border-t pt-3">
									{/* Pausieren liegt bewusst hier statt als Schalter in der Zeile: kein versehentliches Antippen. */}
									<Button
										variant="outline"
										className="min-h-11"
										onClick={() => onTogglePause(abo)}
										disabled={pending}
										aria-label={
											isPaused ? `${abo.description} fortsetzen` : `${abo.description} pausieren`
										}
									>
										{isPaused ? (
											<Play data-icon="inline-start" />
										) : (
											<Pause data-icon="inline-start" />
										)}
										{isPaused ? 'Fortsetzen' : 'Pausieren'}
									</Button>
									<Button
										variant="outline"
										size="icon"
										className="size-11"
										onClick={() => onEdit(abo)}
										disabled={pending}
										aria-label={`${abo.description} bearbeiten`}
									>
										<Pencil />
										<span className="sr-only">{abo.description} bearbeiten</span>
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="size-11"
										onClick={() => onDelete(abo)}
										disabled={pending}
										aria-label={`${abo.description} löschen`}
									>
										<Trash2 />
										<span className="sr-only">{abo.description} löschen</span>
									</Button>
								</div>
							</div>
						</CollapsiblePanel>
					</Collapsible>
				</ItemFooter>
			</Item>
		</li>
	);
}

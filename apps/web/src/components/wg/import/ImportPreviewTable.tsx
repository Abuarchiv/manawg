'use client';

import { formatEuroCents } from '@/core/utils/money';
import type { ParsedExpense } from '@/lib/wg/import-parsers';

interface MemberOption {
	id: string;
	name: string;
}

interface Props {
	expenses: ReadonlyArray<ParsedExpense>;
	mapping: Readonly<Record<string, string | null>>;
	members: readonly MemberOption[];
	skipIndexes: ReadonlySet<number>;
	onToggleSkip: (index: number) => void;
}

function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(date);
}

function resolveName(
	mapping: Readonly<Record<string, string | null>>,
	members: readonly MemberOption[],
	parsedName: string,
): string {
	const id = mapping[parsedName];
	if (!id) return `${parsedName} (nicht zugeordnet)`;
	const member = members.find((m) => m.id === id);
	return member?.name ?? parsedName;
}

export function ImportPreviewTable({
	expenses,
	mapping,
	members,
	skipIndexes,
	onToggleSkip,
}: Props) {
	if (expenses.length === 0) {
		return (
			<p className="rounded-md border border-[var(--border)] p-4 text-[13px] text-[var(--text-3)]">
				Keine Ausgaben gefunden.
			</p>
		);
	}

	return (
		<>
			<ul className="space-y-2 sm:hidden" aria-label="Import-Vorschau">
				{expenses.map((parsed, index) => {
					const isSkipped = skipIndexes.has(index);
					const splitsText = parsed.splits
						.map(
							(s) =>
								`${resolveName(mapping, members, s.memberName)}: ${formatEuroCents(s.amountCents)}`,
						)
						.join(', ');
					return (
						<li
							key={`m-${parsed.date}-${index}`}
							className={`rounded-md border border-[var(--border)] bg-[var(--bg-base)] p-3 text-[13px] ${
								isSkipped ? 'opacity-50' : ''
							}`}
						>
							<label className="flex min-h-11 items-start gap-3">
								<input
									type="checkbox"
									aria-label={`Eintrag ${index + 1} importieren`}
									checked={!isSkipped}
									onChange={() => onToggleSkip(index)}
									className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								/>
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex items-baseline justify-between gap-2">
										<span className="min-w-0 flex-1 truncate font-medium text-[var(--text-1)]">
											{parsed.description}
										</span>
										<span className="shrink-0 font-mono tabular-nums text-[var(--text-1)]">
											{formatEuroCents(parsed.amountCents)}
										</span>
									</div>
									<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-3)]">
										<span>{formatDate(parsed.date)}</span>
										<span>· {resolveName(mapping, members, parsed.paidByName)}</span>
									</div>
									{splitsText && (
										<p className="text-[12px] text-[var(--text-3)]">
											<span className="text-[var(--text-2)]">Aufteilung:</span> {splitsText}
										</p>
									)}
									{parsed.warnings.length > 0 && (
										<p className="text-[12px] text-[var(--text-3)]">
											<span className="text-[var(--text-2)]">Warnungen:</span>{' '}
											{parsed.warnings.join(', ')}
										</p>
									)}
								</div>
							</label>
						</li>
					);
				})}
			</ul>
			<div className="hidden overflow-x-auto rounded-md border border-[var(--border)] sm:block">
				<table className="w-full min-w-[640px] text-left text-[12.5px]">
					<caption className="sr-only">Vorschau zu importierender Ausgaben</caption>
					<thead className="bg-[var(--surface)] text-[var(--text-2)]">
						<tr>
							<th scope="col" className="px-3 py-2">
								Import
							</th>
							<th scope="col" className="px-3 py-2">
								Datum
							</th>
							<th scope="col" className="px-3 py-2">
								Beschreibung
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Betrag
							</th>
							<th scope="col" className="px-3 py-2">
								Bezahlt von
							</th>
							<th scope="col" className="px-3 py-2">
								Aufteilung
							</th>
							<th scope="col" className="px-3 py-2">
								Warnungen
							</th>
						</tr>
					</thead>
					<tbody>
						{expenses.map((parsed, index) => {
							const isSkipped = skipIndexes.has(index);
							return (
								<tr
									key={`${parsed.date}-${index}`}
									className={`border-t border-[var(--border)] ${isSkipped ? 'opacity-50' : ''}`}
								>
									<td className="px-3 py-2">
										<label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center">
											<input
												type="checkbox"
												aria-label={`Eintrag ${parsed.description || `#${index + 1}`} vom ${formatDate(parsed.date)} (${formatEuroCents(parsed.amountCents)}) importieren`}
												checked={!isSkipped}
												onChange={() => onToggleSkip(index)}
												className="h-5 w-5 cursor-pointer accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
											/>
										</label>
									</td>
									<td className="px-3 py-2 whitespace-nowrap">{formatDate(parsed.date)}</td>
									<td className="px-3 py-2 text-[var(--text-1)]">{parsed.description}</td>
									<td className="px-3 py-2 text-right font-mono tabular-nums">
										{formatEuroCents(parsed.amountCents)}
									</td>
									<td className="px-3 py-2">{resolveName(mapping, members, parsed.paidByName)}</td>
									<td className="px-3 py-2">
										{parsed.splits
											.map(
												(s) =>
													`${resolveName(mapping, members, s.memberName)}: ${formatEuroCents(s.amountCents)}`,
											)
											.join(', ')}
									</td>
									<td className="px-3 py-2 text-[var(--text-3)]">{parsed.warnings.join(', ')}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</>
	);
}

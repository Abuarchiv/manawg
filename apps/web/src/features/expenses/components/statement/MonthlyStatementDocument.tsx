import { LogoMark } from '@/components/ui/LogoMark';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { formatEuroCents } from '@/core/utils/money';
import type { MonthlyStatement } from '@/features/expenses/monthly-statement';
import { cn } from '@/shared/lib/cn';

const EYEBROW = 'font-mono text-[11px] tracking-[0.1em] uppercase text-muted-foreground';
const H2 = 'font-heading text-[18px] font-semibold tracking-[-0.02em] print:text-[22px]';
const MONEY = 'font-mono tabular-nums whitespace-nowrap';
const TH = 'py-2 font-normal';

interface MonthlyStatementDocumentProps {
	statement: MonthlyStatement;
	wgName: string;
	shareCode: string;
	viewerId: string;
	viewerName: string;
}

function monthTitle(monthKey: string): string {
	const [year, month] = monthKey.split('-').map(Number);
	return new Intl.DateTimeFormat('de-DE', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, 1)));
}

function period(monthKey: string): string {
	const [year, month] = monthKey.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year ?? 0, month ?? 1, 0)).getUTCDate();
	const mm = String(month).padStart(2, '0');
	return `01.${mm}. – ${lastDay}.${mm}.${year}`;
}

const dayMonth = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	timeZone: 'Europe/Berlin',
});

/** Monthly statement laid out after Brandbook "Abrechnung"; phone column on screen, A4 in print. */
export function MonthlyStatementDocument({
	statement,
	wgName,
	shareCode,
	viewerId,
	viewerName,
}: MonthlyStatementDocumentProps) {
	const { monthKey, members, transfers, categories, items, totalCents, settled } = statement;
	const number = `MWG-${monthKey.slice(2, 4)}${monthKey.slice(5, 7)}-${shareCode.slice(0, 3).toUpperCase()}`;
	const viewerShare = members.find((member) => member.id === viewerId)?.shareCents ?? 0;
	const empty = items.length === 0;
	const transferCount =
		transfers.length === 1 ? 'eine Überweisung' : `${transfers.length} Überweisungen`;

	return (
		<article className="flex flex-col gap-8 text-foreground print:gap-10">
			<header className="flex flex-col gap-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<span className="flex items-center gap-2">
						<LogoMark size={28} tile={false} aria-hidden />
						<span className="font-heading text-[18px] font-semibold tracking-[-0.03em]">
							ManaWG
						</span>
					</span>
					<dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right text-[12px]">
						<dt className="text-left text-muted-foreground">Abrechnung</dt>
						<dd className="font-mono whitespace-nowrap">{number}</dd>
						<dt className="text-left text-muted-foreground">Zeitraum</dt>
						<dd className="font-mono whitespace-nowrap">{period(monthKey)}</dd>
						<dt className="text-left text-muted-foreground">Erstellt für</dt>
						<dd>{viewerName}</dd>
					</dl>
				</div>
				<div className="flex flex-col gap-2">
					<p className={cn(EYEBROW, 'tracking-[0.14em]')}>Monatsabrechnung · {wgName}</p>
					<h1 className="font-heading text-[32px] leading-none font-semibold tracking-[-0.035em] print:text-[52px]">
						{monthTitle(monthKey)}
					</h1>
				</div>
			</header>

			<dl className="grid grid-cols-2 border-t-2 border-b border-t-foreground border-b-border print:grid-cols-4">
				{[
					['Gesamt', formatEuroCents(totalCents)],
					['Ausgaben', String(items.length)],
					['Dein Anteil', formatEuroCents(viewerShare)],
				].map(([label, value], index) => (
					<div
						key={label}
						className={cn(
							'flex flex-col gap-1 py-3',
							index % 2 === 1 ? 'border-l border-border pl-3' : 'pr-3',
							index < 2 && 'border-b border-border print:border-b-0',
							index === 2 && 'print:border-l print:border-border print:pl-3',
						)}
					>
						<dt className="text-[12px] text-muted-foreground">{label}</dt>
						<dd className={cn(MONEY, 'text-[18px] font-medium print:text-[22px]')}>{value}</dd>
					</div>
				))}
				<div className="flex flex-col gap-1 border-l border-border py-3 pl-3">
					<dt className="text-[12px] text-muted-foreground">Status</dt>
					<dd
						className={cn(
							'flex items-center gap-2 text-[15px] font-semibold',
							empty ? 'text-muted-foreground' : settled ? 'text-settled' : 'text-destructive',
						)}
					>
						<span aria-hidden className="size-2 rounded-full bg-current" />
						{empty ? 'Keine Ausgaben' : settled ? 'Ausgeglichen' : 'Offen'}
					</dd>
				</div>
			</dl>

			<section aria-labelledby="statement-balances" className="flex flex-col gap-3">
				<div className="flex items-baseline justify-between gap-3">
					<h2 id="statement-balances" className={H2}>
						Salden
					</h2>
					<span className="text-[12px] text-muted-foreground">
						Geteilt auf {members.length === 1 ? '1 Person' : `${members.length} Personen`}
					</span>
				</div>
				{/* Four columns do not fit at 320 px: the table scrolls sideways instead of the page. */}
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-[14px]">
						<thead>
							<tr className={cn(EYEBROW, 'border-b border-foreground')}>
								<th scope="col" className={cn(TH, 'text-left')}>
									Person
								</th>
								<th scope="col" className={cn(TH, 'pl-3 text-right')}>
									Bezahlt
								</th>
								<th scope="col" className={cn(TH, 'pl-3 text-right')}>
									Anteil
								</th>
								<th scope="col" className={cn(TH, 'pl-3 text-right')}>
									Saldo
								</th>
							</tr>
						</thead>
						<tbody>
							{members.map((member) => (
								<tr key={member.id} className="border-b border-border">
									<th scope="row" className="py-2.5 text-left font-medium">
										<span className="flex min-w-0 items-center gap-2">
											<MemberAvatar name={member.name} size={24} />
											<span className="truncate">{member.name}</span>
											{member.id === viewerId && (
												<span className="text-[12px] font-normal text-muted-foreground">du</span>
											)}
										</span>
									</th>
									<td className={cn(MONEY, 'pl-3 text-right text-[13px]')}>
										{formatEuroCents(member.paidCents)}
									</td>
									<td className={cn(MONEY, 'pl-3 text-right text-[13px] text-muted-foreground')}>
										{formatEuroCents(member.shareCents)}
									</td>
									<td
										className={cn(
											MONEY,
											'pl-3 text-right text-[13px] font-medium',
											member.balanceCents === 0
												? 'text-muted-foreground'
												: member.balanceCents > 0
													? 'text-settled'
													: 'text-destructive',
										)}
									>
										{formatEuroCents(member.balanceCents, 'EUR', { signed: true }).replace(
											'-',
											'−',
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			{transfers.length > 0 && (
				<section aria-labelledby="statement-transfers" className="flex flex-col gap-3">
					<h2 id="statement-transfers" className={H2}>
						Ausgleich
					</h2>
					<p className="text-[13px] leading-relaxed text-muted-foreground">
						Die kürzeste Lösung: {transferCount}, dann sind alle quitt.
					</p>
					<ul className="flex flex-col border-t border-border">
						{transfers.map((transfer) => (
							<li
								key={`${transfer.fromId}-${transfer.toId}`}
								className="flex items-center gap-3 border-b border-border py-2.5 text-[14px]"
							>
								<span className="min-w-0 flex-1">
									<span className="font-medium">{transfer.fromName}</span>
									<span className="text-muted-foreground"> an </span>
									<span className="font-medium">{transfer.toName}</span>
								</span>
								<span className={cn(MONEY, 'text-[13px] font-medium')}>
									{formatEuroCents(transfer.cents)}
								</span>
								<span
									className={cn(
										'w-16 text-right font-mono text-[11px] tracking-[0.06em] uppercase',
										settled ? 'text-settled' : 'text-destructive',
									)}
								>
									{settled ? 'erledigt' : 'offen'}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{!empty && (
				<section aria-labelledby="statement-categories" className="flex flex-col gap-3">
					<h2 id="statement-categories" className={H2}>
						Kategorien
					</h2>
					<ul className="flex flex-col border-t border-border">
						{categories.map((entry) => (
							<li
								key={entry.category}
								className="flex items-center gap-3 border-b border-border py-2.5 text-[14px]"
							>
								<span className="min-w-0 flex-1 font-medium">{entry.label}</span>
								<span className={cn(MONEY, 'text-[13px] font-medium')}>
									{formatEuroCents(entry.cents)}
								</span>
								<span className={cn(MONEY, 'w-10 text-right text-[12px] text-muted-foreground')}>
									{entry.share} %
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{!empty && (
				<section aria-labelledby="statement-items" className="flex flex-col gap-3">
					<div className="flex items-baseline justify-between gap-3">
						<h2 id="statement-items" className={H2}>
							Alle Ausgaben
						</h2>
						<span className="text-[12px] text-muted-foreground">
							{items.length === 1 ? '1 Eintrag' : `${items.length} Einträge`}, nach Datum
						</span>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full border-collapse text-[13px]">
							<thead>
								<tr className={cn(EYEBROW, 'border-b border-foreground')}>
									<th scope="col" className={cn(TH, 'w-12 text-left print:w-16')}>
										Datum
									</th>
									<th scope="col" className={cn(TH, 'pl-3 text-left')}>
										Beschreibung
									</th>
									<th scope="col" className={cn(TH, 'hidden pl-3 text-left print:table-cell')}>
										Von
									</th>
									<th scope="col" className={cn(TH, 'pl-3 text-right')}>
										Betrag
									</th>
								</tr>
							</thead>
							<tbody>
								{items.map((item) => (
									<tr
										key={item.id}
										className="break-inside-avoid border-b border-border/60 align-top"
									>
										<td className="py-2 font-mono text-[12px] text-muted-foreground">
											{dayMonth.format(new Date(item.occurredAt))}
										</td>
										<td className="py-2 pl-3 break-words">
											{item.description}
											<span className="block text-[12px] text-muted-foreground print:hidden">
												{item.payerName}
											</span>
										</td>
										<td className="hidden py-2 pl-3 text-muted-foreground print:table-cell">
											{item.payerName}
										</td>
										<td className={cn(MONEY, 'py-2 pl-3 text-right text-[12px]')}>
											{formatEuroCents(item.amountCents)}
										</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr className="border-t border-foreground font-semibold">
									<th scope="row" colSpan={2} className="py-3 text-left print:hidden">
										Summe
									</th>
									<th scope="row" colSpan={3} className="hidden py-3 text-left print:table-cell">
										Summe
									</th>
									<td className={cn(MONEY, 'py-3 pl-3 text-right text-[13px]')}>
										{formatEuroCents(totalCents)}
									</td>
								</tr>
							</tfoot>
						</table>
					</div>
				</section>
			)}

			<footer className="grid gap-5 border-t border-border pt-5 text-[12px] leading-relaxed text-muted-foreground print:grid-cols-2 print:gap-10">
				<div className="flex flex-col gap-1">
					<p className={cn(EYEBROW, 'text-foreground')}>So rechnen wir</p>
					<p>
						Jede Ausgabe wird so verteilt, wie sie eingetragen ist. Saldo = bezahlt minus Anteil.
						Positiv heißt: Du bekommst Geld zurück.
					</p>
				</div>
				<div className="flex flex-col gap-1">
					<p className={cn(EYEBROW, 'text-foreground')}>Hinweis</p>
					<p>
						Diese Übersicht ist keine Rechnung im steuerlichen Sinn. Belege und Fotos findest du an
						jeder Ausgabe in der App. Export als CSV unter Einstellungen → Daten.
					</p>
				</div>
			</footer>
		</article>
	);
}

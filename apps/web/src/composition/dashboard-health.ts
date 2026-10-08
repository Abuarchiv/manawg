import { formatEuro } from './dashboard-today';

interface WgHealthInput {
	shareCode: string;
	openShoppingCount: number;
	overdueChoreCount: number;
	openDebtCents?: number;
	openDebtByCurrency?: Readonly<Record<string, number>>;
	openAnnouncementCount: number;
	absentMemberCount: number;
	dueRecurringCount: number;
}

export interface WgHealth {
	score: number;
	label: string;
	items: Array<{ label: string; value: string; tone: 'ok' | 'warn' | 'danger'; href: string }>;
}

function formatCurrencyTotals(totals: Readonly<Record<string, number>>): string {
	const entries = Object.entries(totals)
		.filter(([, cents]) => cents !== 0)
		.sort(([left], [right]) => left.localeCompare(right));
	return entries.length > 0
		? entries.map(([currency, cents]) => formatEuro(cents, currency)).join(' · ')
		: formatEuro(0);
}

export function getWgHealth(input: WgHealthInput): WgHealth {
	const base = `/wg/${encodeURIComponent(input.shareCode)}`;
	const openDebtByCurrency =
		input.openDebtByCurrency ??
		(input.openDebtCents !== undefined ? { EUR: input.openDebtCents } : {});
	const openDebtCurrencies = Object.entries(openDebtByCurrency).filter(([, cents]) => cents > 0);
	// Never add cents from different currencies. The score penalty is a count of
	// outstanding debt bands, not a pretend converted monetary total.
	const openDebtPenalty = Math.min(
		25,
		openDebtCurrencies.reduce(
			(penalty, [, cents]) => penalty + Math.min(Math.ceil(cents / 2500) * 5, 25),
			0,
		),
	);
	const penalties =
		Math.min(input.overdueChoreCount * 18, 36) +
		Math.min(input.openShoppingCount * 4, 16) +
		openDebtPenalty +
		Math.min(input.openAnnouncementCount * 6, 18) +
		Math.min(input.dueRecurringCount * 10, 20);
	const score = Math.max(0, 100 - penalties);
	return {
		score,
		label: score >= 80 ? 'ruhig' : score >= 55 ? 'im Blick behalten' : 'braucht Aufmerksamkeit',
		items: [
			{
				label: 'Putzlücken',
				value: String(input.overdueChoreCount),
				tone: input.overdueChoreCount > 0 ? 'danger' : 'ok',
				href: `${base}/putzen?filter=overdue`,
			},
			{
				label: 'Offene Schulden',
				value: formatCurrencyTotals(openDebtByCurrency),
				tone: openDebtCurrencies.length > 0 ? 'warn' : 'ok',
				href: `${base}/ausgaben`,
			},
			{
				label: 'Einkauf offen',
				value: String(input.openShoppingCount),
				tone: input.openShoppingCount > 3 ? 'warn' : 'ok',
				href: `${base}/einkauf`,
			},
			{
				label: 'Pinnwand offen',
				value: String(input.openAnnouncementCount),
				tone: input.openAnnouncementCount > 0 ? 'warn' : 'ok',
				href: `${base}/pinnwand?status=open`,
			},
			{
				label: 'Abwesend',
				value: String(input.absentMemberCount),
				tone: input.absentMemberCount > 0 ? 'warn' : 'ok',
				href: `${base}/putzen?panel=absences`,
			},
			{
				label: 'Fixkosten fällig',
				value: String(input.dueRecurringCount),
				tone: input.dueRecurringCount > 0 ? 'warn' : 'ok',
				href: `${base}/ausgaben?filter=recurring`,
			},
		],
	};
}

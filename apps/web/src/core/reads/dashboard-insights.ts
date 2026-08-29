import { berlinDayKey } from '@/core/utils/berlin-day';
import { formatEuroCents } from '@/core/utils/money';
import { MS_PER_DAY, formatShortDate, parseTimestamp } from '@/core/utils/time';

export type TodayImportantKind =
	| 'chore'
	| 'shopping'
	| 'announcement'
	| 'debt'
	| 'recurring'
	| 'absence';

interface TodayImportantItem {
	kind: TodayImportantKind;
	title: string;
	detail: string;
	href: string;
	tone: 'danger' | 'accent' | 'neutral';
}

interface TodayFocusItem extends TodayImportantItem {
	actionLabel: string;
}

interface TodayImportantInput {
	shareCode: string;
	myBalanceCents: number;
	openShoppingTop: string[];
	dueChores: Array<{
		id: string;
		title: string;
		nextDueAt: string;
		overdue: boolean;
	}>;
	myOpenAnnouncements: Array<{
		id: string;
		kind: string;
		content: string;
	}>;
	dueRecurringExpenses?: Array<{
		id: string;
		description: string;
		amountCents: number;
	}>;
	absentMembers?: Array<{
		id?: string;
		memberId: string;
		name: string;
		endDate: string;
		isCurrentMember: boolean;
	}>;
	now?: number;
}

interface EmptyWgAction {
	id: string;
	title: string;
	detail: string;
	href: string;
}

interface EmptyWgActionInput {
	shareCode: string;
	memberCount: number;
	choreCount: number;
	hasExpense: boolean;
	hasShoppingItem: boolean;
	hasAnnouncement: boolean;
	notificationsEnabled: boolean;
}

interface WgHealthInput {
	shareCode: string;
	openShoppingCount: number;
	overdueChoreCount: number;
	openDebtCents: number;
	openAnnouncementCount: number;
	absentMemberCount: number;
	dueRecurringCount: number;
}

export interface WgHealth {
	score: number;
	label: string;
	items: Array<{ label: string; value: string; tone: 'ok' | 'warn' | 'danger'; href: string }>;
}

function formatEuro(cents: number): string {
	return formatEuroCents(cents);
}

function withQuery(path: string, params: Record<string, string>): string {
	const searchParams = new URLSearchParams(params);
	return `${path}?${searchParams.toString()}`;
}

function dueLabel(iso: string, now: number): string {
	const dueAt = parseTimestamp(iso);
	if (dueAt === null) return 'Datum prüfen';
	// Calendar-day difference in Berlin time — a plain ms/24h rounding put
	// same-day-evening chores under "morgen" and 13h-overdue items at "1 T.".
	const dueKey = berlinDayKey(new Date(dueAt));
	const nowKey = berlinDayKey(new Date(now));
	const days = Math.round(
		(Date.parse(`${dueKey}T12:00:00Z`) - Date.parse(`${nowKey}T12:00:00Z`)) / MS_PER_DAY,
	);
	if (days < 0) return `${Math.abs(days)} T. überfällig`;
	if (days === 0) return 'heute fällig';
	if (days === 1) return 'morgen fällig';
	return `in ${days} Tagen`;
}

export function getTodayImportantItems(input: TodayImportantInput): TodayImportantItem[] {
	const now = input.now ?? Date.now();
	const base = `/wg/${encodeURIComponent(input.shareCode)}`;
	const items: TodayImportantItem[] = [];

	for (const chore of input.dueChores.slice(0, 2)) {
		items.push({
			kind: 'chore',
			title: chore.title,
			detail: dueLabel(chore.nextDueAt, now),
			href: `${base}/putzen?highlight=${encodeURIComponent(chore.id)}`,
			tone: chore.overdue ? 'danger' : 'accent',
		});
	}

	if (input.openShoppingTop.length > 0) {
		items.push({
			kind: 'shopping',
			title: `${input.openShoppingTop[0]} fehlt noch`,
			detail:
				input.openShoppingTop.length > 1
					? `${input.openShoppingTop.length} offene Artikel`
					: '1 offener Artikel',
			href: `${base}/einkauf`,
			tone: 'neutral',
		});
	}

	for (const announcement of input.myOpenAnnouncements.slice(0, 2)) {
		items.push({
			kind: 'announcement',
			title: announcement.content,
			detail: announcement.kind === 'request' ? 'Übernahme offen' : 'Pinnwand offen',
			href: `${base}/pinnwand#announcement-${encodeURIComponent(announcement.id)}`,
			tone: 'accent',
		});
	}

	for (const recurring of (input.dueRecurringExpenses ?? []).slice(0, 2)) {
		items.push({
			kind: 'recurring',
			title: `${recurring.description} ist fällig`,
			detail: formatEuro(recurring.amountCents),
			href: `${base}/ausgaben?recurring=${encodeURIComponent(recurring.id)}`,
			tone: 'accent',
		});
	}

	for (const absence of (input.absentMembers ?? []).slice(0, 2)) {
		items.push({
			kind: 'absence',
			title: absence.isCurrentMember
				? 'Du bist als abwesend markiert'
				: `${absence.name} ist abwesend`,
			detail: `bis ${formatShortDate(absence.endDate)}`,
			href: absence.id
				? `${base}/putzen?panel=absences&absence=${encodeURIComponent(absence.id)}`
				: `${base}/putzen?panel=absences`,
			tone: 'neutral',
		});
	}

	if (input.myBalanceCents < 0) {
		items.push({
			kind: 'debt',
			title: `Du schuldest noch ${formatEuro(Math.abs(input.myBalanceCents))}`,
			detail: 'Ausgaben ausgleichen',
			href: `${base}/ausgaben`,
			tone: 'danger',
		});
	}

	return items.slice(0, 6);
}

export function getTodayFocus(items: TodayImportantItem[]): TodayFocusItem | null {
	const [focus] = [...items].sort((a, b) => {
		function score(item: TodayImportantItem): number {
			if (item.tone === 'danger') return 0;
			if (item.kind === 'recurring' || item.kind === 'chore') return 1;
			if (item.tone === 'accent') return 2;
			return 3;
		}
		return score(a) - score(b);
	});
	if (!focus) return null;
	return {
		...focus,
		actionLabel: focus.tone === 'danger' ? 'Jetzt klären' : 'Öffnen',
	};
}

export function getTodayListItems(
	items: TodayImportantItem[],
	focus: TodayFocusItem | null,
): TodayImportantItem[] {
	if (!focus) return items;
	return items.filter(
		(item) =>
			item.kind !== focus.kind ||
			item.href !== focus.href ||
			item.title !== focus.title ||
			item.detail !== focus.detail,
	);
}

export function getEmptyWgActions(input: EmptyWgActionInput): EmptyWgAction[] {
	const base = `/wg/${encodeURIComponent(input.shareCode)}`;
	const actions: EmptyWgAction[] = [];

	if (input.memberCount < 2) {
		actions.push({
			id: 'invite',
			title: 'Mitbewohner einladen',
			detail: 'Share-Code teilen und WG gemeinsam füllen.',
			href: `${base}/einstellungen`,
		});
	}
	if (input.choreCount === 0) {
		actions.push({
			id: 'chores',
			title: 'Putzplan starten',
			detail: 'Beispiel ist vorausgefüllt, damit nichts liegen bleibt.',
			href: withQuery(`${base}/putzen`, { title: 'Bad putzen' }),
		});
	}
	if (!input.hasExpense) {
		actions.push({
			id: 'expense',
			title: 'Erste Ausgabe eintragen',
			detail: 'Internet ist vorausgefüllt und kann direkt angepasst werden.',
			href: withQuery(`${base}/ausgaben`, { desc: 'Internet', amount: '32,90' }),
		});
	}
	if (!input.hasShoppingItem) {
		actions.push({
			id: 'shopping',
			title: 'Einkaufsliste füllen',
			detail: 'Milch ist vorausgefüllt, damit die Liste sofort nutzbar wird.',
			href: `${base}/einkauf?name=Milch`,
		});
	}
	if (!input.hasAnnouncement) {
		actions.push({
			id: 'announcement',
			title: 'Ersten Pinnwand-Beitrag schreiben',
			detail: 'Paket im Flur ist vorausgefüllt und kann direkt ersetzt werden.',
			href: withQuery(`${base}/pinnwand`, { content: 'Paket im Flur', kind: 'question' }),
		});
	}
	if (!input.notificationsEnabled) {
		actions.push({
			id: 'notifications',
			title: 'Benachrichtigungen prüfen',
			detail: 'Nur wichtige WG-Sachen landen rechtzeitig bei dir.',
			href: `${base}/einstellungen#benachrichtigungen`,
		});
	}

	return actions.slice(0, 5);
}

export function getWgHealth(input: WgHealthInput): WgHealth {
	const base = `/wg/${encodeURIComponent(input.shareCode)}`;
	const penalties =
		Math.min(input.overdueChoreCount * 18, 36) +
		Math.min(input.openShoppingCount * 4, 16) +
		Math.min(Math.ceil(input.openDebtCents / 2500) * 5, 25) +
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
				value: formatEuro(input.openDebtCents),
				tone: input.openDebtCents > 0 ? 'warn' : 'ok',
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

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

export interface TodayImportantItem {
	kind: TodayImportantKind;
	title: string;
	detail: string;
	href: string;
	tone: 'danger' | 'accent' | 'neutral';
	isPersonal: boolean;
	entityId?: string;
}

export interface TodayFocusItem extends TodayImportantItem {
	actionLabel: string;
}

export interface TodayImportantInput {
	shareCode: string;
	currentMemberId: string;
	openShoppingCount: number;
	openShoppingTop: string[];
	dueChores: Array<{
		id: string;
		title: string;
		nextDueAt: string;
		overdue: boolean;
		assignedMemberId?: string | null;
		assignedMemberName?: string | null;
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
		nextDueAt?: string;
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

function calendarDayDistance(iso: string, now: number): number | null {
	const dueAt = parseTimestamp(iso);
	if (dueAt === null) return null;
	// Calendar-day difference in Berlin time — a plain ms/24h rounding put
	// same-day-evening chores under "morgen" and 13h-overdue items at "1 T.".
	const dueKey = berlinDayKey(new Date(dueAt));
	const nowKey = berlinDayKey(new Date(now));
	return Math.round(
		(Date.parse(`${dueKey}T12:00:00Z`) - Date.parse(`${nowKey}T12:00:00Z`)) / MS_PER_DAY,
	);
}

function dueLabel(iso: string, now: number): string {
	const days = calendarDayDistance(iso, now);
	if (days === null) return 'Datum prüfen';
	if (days < 0) return `${Math.abs(days)} T. überfällig`;
	if (days === 0) return 'heute fällig';
	if (days === 1) return 'morgen fällig';
	return `in ${days} Tagen`;
}

function choreUrgency(iso: string, now: number): number {
	const days = calendarDayDistance(iso, now);
	if (days === null) return 4;
	if (days < 0) return 0;
	if (days === 0) return 1;
	if (days <= 3) return 2;
	return 3;
}

export function getTodayImportantItems(input: TodayImportantInput): TodayImportantItem[] {
	const now = input.now ?? Date.now();
	const base = `/wg/${encodeURIComponent(input.shareCode)}`;
	const ranked: Array<{
		item: TodayImportantItem;
		urgency: number;
		isPersonal: boolean;
		dueAt: number;
		kindOrder: number;
		index: number;
	}> = [];

	const choreItems = input.dueChores
		.map((chore, index) => {
			const urgency = choreUrgency(chore.nextDueAt, now);
			const isPersonal = chore.assignedMemberId === input.currentMemberId;
			const due = dueLabel(chore.nextDueAt, now);
			const ownership = isPersonal
				? 'Du bist dran'
				: chore.assignedMemberName
					? chore.assignedMemberName
					: 'Noch nicht zugewiesen';
			return {
				item: {
					kind: 'chore' as const,
					title: chore.title,
					detail: ownership ? `${ownership} · ${due}` : due,
					href: `${base}/putzen?highlight=${encodeURIComponent(chore.id)}`,
					tone: urgency === 0 ? ('danger' as const) : ('accent' as const),
					isPersonal,
					entityId: chore.id,
				},
				urgency,
				isPersonal,
				dueAt: parseTimestamp(chore.nextDueAt) ?? Number.POSITIVE_INFINITY,
				index,
			};
		})
		.filter(({ urgency }) => urgency !== 3)
		.map(({ item, urgency, isPersonal, dueAt, index }) => ({
			item,
			urgency,
			isPersonal,
			dueAt,
			kindOrder: 0,
			index,
		}));
	ranked.push(...choreItems);

	if (input.openShoppingCount > 0) {
		ranked.push({
			item: {
				kind: 'shopping',
				title: input.openShoppingTop[0]
					? `${input.openShoppingTop[0]} fehlt noch`
					: 'Einkauf offen',
				detail:
					input.openShoppingCount === 1
						? '1 offener Artikel'
						: `${input.openShoppingCount} offene Artikel`,
				href: `${base}/einkauf`,
				tone: 'neutral',
				isPersonal: false,
			},
			urgency: 3,
			isPersonal: false,
			dueAt: Number.POSITIVE_INFINITY,
			kindOrder: 2,
			index: 0,
		});
	}

	for (const [index, announcement] of input.myOpenAnnouncements.entries()) {
		ranked.push({
			item: {
				kind: 'announcement',
				title: announcement.content,
				detail: announcement.kind === 'request' ? 'Übernahme offen' : 'Pinnwand offen',
				href: `${base}/pinnwand#announcement-${encodeURIComponent(announcement.id)}`,
				tone: 'accent',
				isPersonal: true,
				entityId: announcement.id,
			},
			urgency: 3,
			isPersonal: true,
			dueAt: Number.POSITIVE_INFINITY,
			kindOrder: 1,
			index,
		});
	}

	for (const [index, recurring] of (input.dueRecurringExpenses ?? []).entries()) {
		const urgency = recurring.nextDueAt === undefined ? 0 : choreUrgency(recurring.nextDueAt, now);
		ranked.push({
			item: {
				kind: 'recurring',
				title: `${recurring.description} ist fällig`,
				detail: recurring.nextDueAt
					? `${formatEuro(recurring.amountCents)} · ${dueLabel(recurring.nextDueAt, now)}`
					: formatEuro(recurring.amountCents),
				href: `${base}/ausgaben?recurring=${encodeURIComponent(recurring.id)}`,
				tone: urgency === 0 ? 'danger' : 'accent',
				isPersonal: false,
				entityId: recurring.id,
			},
			urgency,
			isPersonal: false,
			dueAt: recurring.nextDueAt
				? (parseTimestamp(recurring.nextDueAt) ?? Number.POSITIVE_INFINITY)
				: Number.POSITIVE_INFINITY,
			kindOrder: 1,
			index,
		});
	}

	for (const [index, absence] of (input.absentMembers ?? []).entries()) {
		ranked.push({
			item: {
				kind: 'absence',
				title: absence.isCurrentMember
					? 'Du bist als abwesend markiert'
					: `${absence.name} ist abwesend`,
				detail: `bis ${formatShortDate(absence.endDate)}`,
				href: absence.id
					? `${base}/putzen?panel=absences&absence=${encodeURIComponent(absence.id)}`
					: `${base}/putzen?panel=absences`,
				tone: 'neutral',
				isPersonal: absence.isCurrentMember,
				...(absence.id ? { entityId: absence.id } : {}),
			},
			urgency: 3,
			isPersonal: absence.isCurrentMember,
			dueAt: Number.POSITIVE_INFINITY,
			kindOrder: 3,
			index,
		});
	}

	return ranked
		.sort(
			(a, b) =>
				a.urgency - b.urgency ||
				Number(b.isPersonal) - Number(a.isPersonal) ||
				a.dueAt - b.dueAt ||
				a.kindOrder - b.kindOrder ||
				a.index - b.index,
		)
		.map(({ item }) => item);
}

export function getTodayFocus(items: TodayImportantItem[]): TodayFocusItem | null {
	const [focus] = items;
	if (!focus) return null;
	return {
		...focus,
		actionLabel:
			{
				chore: 'Aufgabe ansehen',
				shopping: 'Einkaufsliste öffnen',
				announcement: 'Beitrag ansehen',
				recurring: 'Buchung prüfen',
				absence: 'Abwesenheit ansehen',
				debt: 'Finanzen öffnen',
			}[focus.kind] ?? 'Öffnen',
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

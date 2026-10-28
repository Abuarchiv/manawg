import { berlinCalendarDayDistance } from '@/core/utils/berlin-day';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate, parseTimestamp } from '@/core/utils/time';
import { simplifyDebts } from '@/features/expenses/debt-reduction';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';

export type TodayImportantKind =
	| 'chore'
	| 'shopping'
	| 'announcement'
	| 'debt'
	| 'recurring'
	| 'absence';

export interface TodayImportantItem {
	kind: TodayImportantKind;
	/** User content (a chore or post title) stays a string; generated copy is a message. */
	title: string | Message;
	detail: string | Message;
	href: string;
	tone: 'danger' | 'accent' | 'neutral';
	isPersonal: boolean;
	entityId?: string;
	expectedNextDueAt?: string;
	expectedAssignedMemberId?: string | null;
	amountCents?: number;
	currency?: string;
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
	balances?: Array<{
		memberId: string;
		memberName: string;
		color: string | null;
		balanceCents: number;
		currency: string;
	}>;
	dueRecurringExpenses?: Array<{
		id: string;
		description: string;
		amountCents: number;
		currency?: string;
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
	/** Language of the amounts and dates inside the messages. */
	locale?: Locale;
}

function calendarDayDistance(iso: string, now: number): number | null {
	const dueAt = parseTimestamp(iso);
	return dueAt === null ? null : berlinCalendarDayDistance(new Date(now), new Date(dueAt));
}

export function dueLabel(iso: string, now: number): Message {
	const days = calendarDayDistance(iso, now);
	if (days === null) return { key: 'home.due.checkDate' };
	if (days < 0) return { key: 'home.due.overdue', values: { count: Math.abs(days) } };
	if (days === 0) return { key: 'home.due.today' };
	if (days === 1) return { key: 'home.due.tomorrow' };
	return { key: 'home.due.inDays', values: { count: days } };
}

export function choreUrgency(iso: string, now: number): number {
	const days = calendarDayDistance(iso, now);
	if (days === null) return 4;
	if (days < 0) return 0;
	if (days === 0) return 1;
	if (days <= 3) return 2;
	return 3;
}

function recurringAmount(
	recurring: { amountCents: number; currency?: string },
	locale: Locale,
): string {
	return formatEuroCents(recurring.amountCents, recurring.currency, { locale });
}

export function getTodayImportantItems(input: TodayImportantInput): TodayImportantItem[] {
	const now = input.now ?? Date.now();
	const locale = input.locale ?? 'de';
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
			const owner: string | Message = chore.assignedMemberName ?? { key: 'home.today.unassigned' };
			const detail: Message = isPersonal
				? due
				: { key: 'home.today.choreDetail', values: { owner, due } };
			return {
				item: {
					kind: 'chore' as const,
					title: chore.title,
					detail,
					href: `${base}/chores?highlight=${encodeURIComponent(chore.id)}`,
					tone: urgency === 0 ? ('danger' as const) : ('accent' as const),
					isPersonal,
					entityId: chore.id,
					expectedNextDueAt: chore.nextDueAt,
					expectedAssignedMemberId: chore.assignedMemberId ?? null,
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
					? { key: 'home.today.itemMissing', values: { name: input.openShoppingTop[0] } }
					: { key: 'home.today.shoppingOpen' },
				detail: { key: 'home.today.shoppingDetail', values: { count: input.openShoppingCount } },
				href: `${base}/shopping`,
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
				detail: {
					key:
						announcement.kind === 'request'
							? 'home.today.takeoverOpen'
							: 'home.today.noticeboardOpen',
				},
				href: `${base}/pinboard#announcement-${encodeURIComponent(announcement.id)}`,
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
				title: recurring.description,
				detail: recurring.nextDueAt
					? {
							key: 'home.today.recurringDue',
							values: {
								amount: recurringAmount(recurring, locale),
								due: dueLabel(recurring.nextDueAt, now),
							},
						}
					: { key: 'home.today.recurring', values: { amount: recurringAmount(recurring, locale) } },
				href: `${base}/expenses?recurring=${encodeURIComponent(recurring.id)}`,
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

	const balances = (input.balances ?? []).map(({ balanceCents, ...balance }) => ({
		...balance,
		cents: balanceCents,
	}));
	for (const [index, debt] of simplifyDebts(balances).entries()) {
		const outgoing = debt.fromId === input.currentMemberId;
		if (!outgoing && debt.toId !== input.currentMemberId) continue;
		ranked.push({
			item: {
				kind: 'debt',
				title: {
					key: 'home.today.debtTitle',
					values: {
						direction: outgoing ? 'outgoing' : 'incoming',
						name: outgoing ? debt.toName : debt.fromName,
					},
				},
				detail: { key: outgoing ? 'home.today.youPay' : 'home.today.youReceive' },
				href: `${base}/expenses`,
				tone: outgoing ? 'danger' : 'neutral',
				isPersonal: true,
				entityId: `settlement:${debt.fromId}:${debt.toId}:${debt.currency ?? 'EUR'}`,
				amountCents: outgoing ? -debt.cents : debt.cents,
				currency: debt.currency ?? 'EUR',
			},
			urgency: outgoing ? 2 : 3,
			isPersonal: true,
			dueAt: Number.POSITIVE_INFINITY,
			kindOrder: outgoing ? 1 : 2,
			index,
		});
	}

	for (const [index, absence] of (input.absentMembers ?? []).entries()) {
		ranked.push({
			item: {
				kind: 'absence',
				title: {
					key: 'home.today.absent',
					values: { self: absence.isCurrentMember ? 'yes' : 'no', name: absence.name },
				},
				detail: {
					key: 'home.today.until',
					values: { date: formatShortDate(absence.endDate, 'Europe/Berlin', locale) },
				},
				href: absence.id
					? `${base}/chores?panel=absences&absence=${encodeURIComponent(absence.id)}`
					: `${base}/chores?panel=absences`,
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

export function getForYouItems(input: TodayImportantInput): TodayImportantItem[] {
	return getTodayImportantItems(input).filter(
		(item) => item.isPersonal || item.kind === 'shopping' || item.kind === 'recurring',
	);
}

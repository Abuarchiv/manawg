import 'server-only';
import { loadConfirmedEmails } from '@/core/auth/auth-user-emails';
import { chores, db, expenses, wgEvents, wgInventoryItems, wgMembers, wgs } from '@/core/db';
import { logApiError } from '@/core/infra/observability';
import { type SendMailResult, sendMail } from '@/core/mail/send-mail';
import { type DigestItem, renderDigestMail } from '@/core/mail/templates';
import { unsubscribeUrl } from '@/core/mail/unsubscribe';
import {
	berlinDayKey,
	endOfBerlinDay,
	nextBerlinDayStart,
	startOfBerlinDay,
} from '@/core/utils/berlin-day';
import { formatEuroCents } from '@/core/utils/money';
import { MS_PER_DAY } from '@/core/utils/time';
import { expandRecurrence } from '@/features/events/events';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

const ITEMS_PER_SECTION = 5;

const timeFormat = new Intl.DateTimeFormat('de-DE', {
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'Europe/Berlin',
});
const dayLabelFormat = new Intl.DateTimeFormat('de-DE', {
	weekday: 'short',
	day: '2-digit',
	month: '2-digit',
	timeZone: 'Europe/Berlin',
});

interface DigestMember {
	id: string;
	authUserId: string;
	notifyChores: boolean;
	notifyExpenses: boolean;
	notifyEvents: boolean;
	notifyInventory: boolean;
}

interface WgDigest {
	wg: { id: string; name: string; shareCode: string };
	members: DigestMember[];
	chores: DigestItem[];
	expenses: DigestItem[];
	events: DigestItem[];
	inventory: DigestItem[];
}

export interface DigestRunSummary {
	dayKey: string;
	wgs: number;
	candidates: number;
	sent: number;
	duplicate: number;
	skipped: number;
	failed: number;
}

/** Caps a section and says how much was left out, so the mail stays one screen long. */
function cap(items: DigestItem[], label: string): DigestItem[] {
	if (items.length <= ITEMS_PER_SECTION) return items;
	const rest = items.length - ITEMS_PER_SECTION;
	return [
		...items.slice(0, ITEMS_PER_SECTION),
		{ label, text: rest === 1 ? '1 weiterer Eintrag' : `${rest} weitere Einträge` },
	];
}

async function loadDigests(now: Date): Promise<WgDigest[]> {
	const dayStart = startOfBerlinDay(now);
	const dayEnd = endOfBerlinDay(now);
	const tomorrowStart = nextBerlinDayStart(dayStart);
	const tomorrowEnd = endOfBerlinDay(tomorrowStart);
	const since = new Date(now.getTime() - MS_PER_DAY);

	const memberRows = await db
		.select({
			id: wgMembers.id,
			authUserId: wgMembers.authUserId,
			notifyChores: wgMembers.notifyChores,
			notifyExpenses: wgMembers.notifyExpenses,
			notifyEvents: wgMembers.notifyEvents,
			notifyInventory: wgMembers.notifyInventory,
			wgId: wgs.id,
			wgName: wgs.name,
			shareCode: wgs.shareCode,
		})
		.from(wgMembers)
		.innerJoin(wgs, eq(wgMembers.wgId, wgs.id))
		.where(
			and(
				eq(wgMembers.pushOptIn, false),
				eq(wgMembers.notifyDigestEmail, true),
				sql`${wgMembers.authUserId} is not null`,
				isNull(wgMembers.deactivatedAt),
			),
		);
	const byWg = new Map<string, WgDigest>();
	for (const row of memberRows) {
		if (!row.authUserId) continue;
		const entry = byWg.get(row.wgId) ?? {
			wg: { id: row.wgId, name: row.wgName, shareCode: row.shareCode },
			members: [],
			chores: [],
			expenses: [],
			events: [],
			inventory: [],
		};
		entry.members.push({
			id: row.id,
			authUserId: row.authUserId,
			notifyChores: row.notifyChores,
			notifyExpenses: row.notifyExpenses,
			notifyEvents: row.notifyEvents,
			notifyInventory: row.notifyInventory,
		});
		byWg.set(row.wgId, entry);
	}
	const wgIds = [...byWg.keys()];
	if (wgIds.length === 0) return [];

	const [choreRows, expenseRows, eventRows, inventoryRows] = await Promise.all([
		db
			.select({
				wgId: chores.wgId,
				title: chores.title,
				nextDueAt: chores.nextDueAt,
				assignee: wgMembers.name,
			})
			.from(chores)
			.leftJoin(wgMembers, eq(chores.assignedMemberId, wgMembers.id))
			.where(and(inArray(chores.wgId, wgIds), lte(chores.nextDueAt, dayEnd)))
			.orderBy(asc(chores.nextDueAt)),
		db
			.select({
				wgId: expenses.wgId,
				description: expenses.description,
				amountCents: expenses.amountCents,
				currency: expenses.currency,
				payer: wgMembers.name,
			})
			.from(expenses)
			.innerJoin(wgMembers, eq(expenses.paidByMemberId, wgMembers.id))
			.where(and(inArray(expenses.wgId, wgIds), gte(expenses.createdAt, since)))
			.orderBy(asc(expenses.createdAt)),
		db
			.select({
				wgId: wgEvents.wgId,
				id: wgEvents.id,
				title: wgEvents.title,
				description: wgEvents.description,
				startsAt: wgEvents.startsAt,
				endsAt: wgEvents.endsAt,
				allDay: wgEvents.allDay,
				location: wgEvents.location,
				recurrence: wgEvents.recurrence,
			})
			.from(wgEvents)
			.where(
				and(
					inArray(wgEvents.wgId, wgIds),
					or(
						sql`${wgEvents.recurrence} is not null`,
						and(gte(wgEvents.startsAt, tomorrowStart), lte(wgEvents.startsAt, tomorrowEnd)),
					),
				),
			),
		db
			.select({
				wgId: wgInventoryItems.wgId,
				name: wgInventoryItems.name,
				quantity: wgInventoryItems.quantity,
				threshold: wgInventoryItems.threshold,
				unit: wgInventoryItems.unit,
			})
			.from(wgInventoryItems)
			.where(
				and(
					inArray(wgInventoryItems.wgId, wgIds),
					lte(wgInventoryItems.quantity, wgInventoryItems.threshold),
				),
			)
			.orderBy(asc(wgInventoryItems.name)),
	]);

	for (const row of choreRows) {
		const overdue = row.nextDueAt < dayStart;
		const who = row.assignee ? `${row.assignee}: ` : '';
		byWg.get(row.wgId)?.chores.push({
			label: 'Putzplan',
			text: `${who}${row.title} ist ${overdue ? 'überfällig' : 'heute dran'}.`,
		});
	}
	for (const row of expenseRows) {
		byWg.get(row.wgId)?.expenses.push({
			label: 'Ausgabe',
			text: `${row.payer} hat ${row.description} eingetragen.`,
			value: formatEuroCents(row.amountCents, row.currency),
		});
	}
	for (const row of eventRows) {
		const occurrences = expandRecurrence(
			{
				id: row.id,
				title: row.title,
				description: row.description,
				startsAt: row.startsAt.toISOString(),
				endsAt: row.endsAt ? row.endsAt.toISOString() : null,
				allDay: row.allDay,
				location: row.location,
				recurrence: row.recurrence,
			},
			tomorrowStart,
			tomorrowEnd,
		);
		for (const occurrence of occurrences) {
			const when = row.allDay
				? 'ganztags'
				: `um ${timeFormat.format(new Date(occurrence.startsAt))}`;
			byWg.get(row.wgId)?.events.push({
				label: 'Termin',
				text: `Morgen: „${row.title}“ ${when}.`,
			});
		}
	}
	for (const row of inventoryRows) {
		byWg.get(row.wgId)?.inventory.push({
			label: 'Vorrat',
			text: `Bald leer: ${row.name}.`,
			value: `${row.quantity} von ${row.threshold} ${row.unit}`,
		});
	}
	for (const entry of byWg.values()) {
		entry.chores = cap(entry.chores, 'Putzplan');
		entry.expenses = cap(entry.expenses, 'Ausgabe');
		entry.events = cap(entry.events, 'Termin');
		entry.inventory = cap(entry.inventory, 'Vorrat');
	}
	return [...byWg.values()];
}

function itemsFor(member: DigestMember, digest: WgDigest): DigestItem[] {
	return [
		...(member.notifyChores ? digest.chores : []),
		...(member.notifyExpenses ? digest.expenses : []),
		...(member.notifyEvents ? digest.events : []),
		...(member.notifyInventory ? digest.inventory : []),
	];
}

/**
 * E7: one mail per day for members without push, listing what happened in
 * their WG; nothing is sent when nothing happened. Idempotent per member and
 * Berlin day through the mail ledger.
 */
export async function runDailyDigest(now = new Date()): Promise<DigestRunSummary> {
	const dayKey = berlinDayKey(now);
	const digests = await loadDigests(now);
	const summary: DigestRunSummary = {
		dayKey,
		wgs: digests.length,
		candidates: 0,
		sent: 0,
		duplicate: 0,
		skipped: 0,
		failed: 0,
	};
	const authUserIds = digests.flatMap((digest) => digest.members.map((m) => m.authUserId));
	const { emails } = await loadConfirmedEmails(authUserIds);
	const dayLabel = dayLabelFormat.format(now).replace(',', ' ·');

	for (const digest of digests) {
		for (const member of digest.members) {
			summary.candidates += 1;
			const items = itemsFor(member, digest);
			const to = emails.get(member.authUserId);
			if (items.length === 0 || !to) {
				summary.skipped += 1;
				continue;
			}
			let result: SendMailResult;
			try {
				result = await sendMail({
					kind: 'digest',
					dedupeKey: `digest:${member.id}:${dayKey}`,
					to,
					wgId: digest.wg.id,
					memberId: member.id,
					unsubscribeUrl: unsubscribeUrl(member.id, 'digest'),
					mail: renderDigestMail({
						wgName: digest.wg.name,
						shareCode: digest.wg.shareCode,
						dayLabel,
						items,
						unsubscribeUrl: unsubscribeUrl(member.id, 'digest'),
					}),
				});
			} catch (err) {
				logApiError('[mail] digest failed', err);
				summary.failed += 1;
				continue;
			}
			if (result === 'sent') summary.sent += 1;
			else if (result === 'duplicate') summary.duplicate += 1;
			else summary.failed += 1;
		}
	}
	return summary;
}

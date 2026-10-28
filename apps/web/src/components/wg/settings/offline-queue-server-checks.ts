import {
	recurringAdvanceConflictNote,
	recurringTemplateConflictNote,
} from '@/core/offline/offline-conflicts';
import type { OfflineAction } from '@/core/offline/offline-queue';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';

/** How to compare a queued action with the server: which list to read and what to say about it. */
export interface ServerCheck {
	path: string;
	note: (payload: Record<string, unknown>, data: never, locale: Locale) => Message;
}

function serverCheck<Data>(
	path: string,
	note: (payload: Record<string, unknown>, data: Data, locale: Locale) => Message,
): ServerCheck {
	return { path, note: note as ServerCheck['note'] };
}

const NOT_FOUND: Message = { key: 'offline.serverCheck.notFound' };

export const SERVER_CHECKS: Record<string, ServerCheck> = {
	'shopping.create': serverCheck<{
		items: Array<{ name: string; quantity: string | null; boughtAt: string | null }>;
	}>('shopping', (payload, data) => {
		const name = String(payload.name ?? '').trim();
		const serverItem = data.items.find((shoppingItem) => shoppingItem.name.trim() === name);
		return serverItem
			? {
					key: 'offline.serverCheck.shoppingDuplicate',
					values: { done: serverItem.boughtAt ? 'yes' : 'no' },
				}
			: NOT_FOUND;
	}),
	'shopping.update': serverCheck<{ items: Array<{ id: string; boughtAt: string | null }> }>(
		'shopping',
		(payload, data) => {
			const itemId = String(payload.itemId ?? '');
			const serverItem = data.items.find((shoppingItem) => shoppingItem.id === itemId);
			return serverItem
				? {
						key: 'offline.serverCheck.shoppingFound',
						values: { done: serverItem.boughtAt ? 'yes' : 'no' },
					}
				: { key: 'offline.serverCheck.shoppingGone' };
		},
	),
	'announcement.create': serverCheck<{
		announcements: Array<{ content: string; resolvedAt?: string | null }>;
	}>('announcements', (payload, data) => {
		const content = String(payload.content ?? '').trim();
		const serverPost = data.announcements.find(
			(announcement) => announcement.content.trim() === content,
		);
		return serverPost
			? {
					key: 'offline.serverCheck.announcementDuplicate',
					values: { resolved: serverPost.resolvedAt ? 'yes' : 'no' },
				}
			: NOT_FOUND;
	}),
	'chore.complete': serverCheck<{ chores: Array<{ id: string }> }>('chores', (payload, data) => {
		const choreId = String(payload.choreId ?? '');
		return data.chores.some((chore) => chore.id === choreId)
			? { key: 'offline.serverCheck.choreFound' }
			: { key: 'offline.serverCheck.choreGone' };
	}),
	'chore.create': serverCheck<{ chores: Array<{ title: string; intervalDays: number }> }>(
		'chores',
		(payload, data) => {
			const title = String(payload.title ?? '').trim();
			const serverChore = data.chores.find((chore) => chore.title.trim() === title);
			return serverChore
				? {
						key: 'offline.serverCheck.choreDuplicate',
						values: { days: serverChore.intervalDays },
					}
				: NOT_FOUND;
		},
	),
	'absence.create': serverCheck<{
		absences: Array<{ memberId: string; startDate: string; endDate: string }>;
	}>('absences', (payload, data) => {
		const absenceMemberId = String(payload.memberId ?? '');
		const startDate = String(payload.startDate ?? '');
		const endDate = String(payload.endDate ?? '');
		const serverAbsence = data.absences.find(
			(absence) =>
				absence.memberId === absenceMemberId &&
				absence.startDate === startDate &&
				absence.endDate === endDate,
		);
		return serverAbsence ? { key: 'offline.serverCheck.absenceDuplicate' } : NOT_FOUND;
	}),
	'expense.create': serverCheck<{ expenses: Array<{ description: string; amountCents: number }> }>(
		'expenses',
		(payload, data) => {
			const description = String(payload.description ?? '').trim();
			const amountCents = Number(payload.amountCents ?? 0);
			const serverExpense = data.expenses.find(
				(expense) =>
					expense.description.trim() === description && expense.amountCents === amountCents,
			);
			return serverExpense ? { key: 'offline.serverCheck.expenseDuplicate' } : NOT_FOUND;
		},
	),
	'recurring.create': serverCheck<{
		recurringExpenses: Array<{ description: string; amountCents: number; nextDueAt: string }>;
	}>('recurring-expenses', (payload, data, locale) => {
		const description = String(payload.description ?? '').trim();
		const amountCents = Number(payload.amountCents ?? 0);
		const serverTemplate = data.recurringExpenses.find(
			(template) =>
				template.description.trim() === description && template.amountCents === amountCents,
		);
		return serverTemplate ? recurringTemplateConflictNote(serverTemplate, locale) : NOT_FOUND;
	}),
	'recurring.advance': serverCheck<{
		recurringExpenses: Array<{ id: string; nextDueAt: string }>;
	}>('recurring-expenses', (payload, data, locale) => {
		const recurringExpenseId = String(payload.recurringExpenseId ?? '');
		const expectedNextDueAt = String(payload.expectedRecurringNextDueAt ?? '');
		const serverTemplate = data.recurringExpenses.find(
			(template) => template.id === recurringExpenseId,
		);
		return serverTemplate
			? recurringAdvanceConflictNote(serverTemplate, expectedNextDueAt, locale)
			: { key: 'offline.serverCheck.templateGone' };
	}),
};

/** The WG page where the member can look at the entry a queued action targets. */
export function offlineActionInspectHref(shareCode: string, item: OfflineAction): string {
	const module = item.type.startsWith('shopping.')
		? 'shopping'
		: item.type === 'announcement.create'
			? 'pinboard'
			: item.type.startsWith('expense.') || item.type.startsWith('recurring.')
				? 'expenses'
				: 'chores';
	return `/wg/${encodeURIComponent(shareCode)}/${module}`;
}

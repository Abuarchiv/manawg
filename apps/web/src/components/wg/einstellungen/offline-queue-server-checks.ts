import {
	formatRecurringAdvanceConflictNote,
	formatRecurringTemplateConflictNote,
} from '@/core/offline/offline-conflicts';
import type { OfflineAction } from '@/core/offline/offline-queue';

/** How to compare a queued action with the server: which list to read and what to say about it. */
export interface ServerCheck {
	path: string;
	note: (payload: Record<string, unknown>, data: never) => string;
}

function serverCheck<Data>(
	path: string,
	note: (payload: Record<string, unknown>, data: Data) => string,
): ServerCheck {
	return { path, note: note as ServerCheck['note'] };
}

export const SERVER_CHECKS: Record<string, ServerCheck> = {
	'shopping.create': serverCheck<{
		items: Array<{ name: string; quantity: string | null; boughtAt: string | null }>;
	}>('shopping', (payload, data) => {
		const name = String(payload.name ?? '').trim();
		const serverItem = data.items.find((shoppingItem) => shoppingItem.name.trim() === name);
		return serverItem
			? `Ähnlicher Einkaufsartikel existiert schon. Status dort: ${
					serverItem.boughtAt ? 'erledigt' : 'offen'
				}. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
			: 'Auf dem Server nicht gefunden.';
	}),
	'shopping.update': serverCheck<{ items: Array<{ id: string; boughtAt: string | null }> }>(
		'shopping',
		(payload, data) => {
			const itemId = String(payload.itemId ?? '');
			const serverItem = data.items.find((shoppingItem) => shoppingItem.id === itemId);
			return serverItem
				? `Server-Version gefunden. Status dort: ${
						serverItem.boughtAt ? 'erledigt' : 'offen'
					}. Prüfe vor dem erneuten Senden, ob das noch stimmt.`
				: 'Der Einkaufsartikel existiert serverseitig nicht mehr.';
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
			? `Gleicher Pinnwand-Beitrag existiert schon. Status dort: ${
					serverPost.resolvedAt ? 'geklärt' : 'offen'
				}. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
			: 'Auf dem Server nicht gefunden.';
	}),
	'chore.complete': serverCheck<{ chores: Array<{ id: string }> }>('chores', (payload, data) => {
		const choreId = String(payload.choreId ?? '');
		return data.chores.some((chore) => chore.id === choreId)
			? 'Server-Version gefunden. Prüfe Zuständigkeit und Fälligkeit vor dem Senden.'
			: 'Die Aufgabe existiert serverseitig nicht mehr.';
	}),
	'chore.create': serverCheck<{ chores: Array<{ title: string; intervalDays: number }> }>(
		'chores',
		(payload, data) => {
			const title = String(payload.title ?? '').trim();
			const serverChore = data.chores.find((chore) => chore.title.trim() === title);
			return serverChore
				? `Gleiche Putzaufgabe existiert schon. Intervall dort: alle ${serverChore.intervalDays} Tage. Prüfe vor dem Senden, ob es ein Duplikat wäre.`
				: 'Auf dem Server nicht gefunden.';
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
		return serverAbsence
			? 'Gleiche Abwesenheit existiert schon auf dem Server.'
			: 'Auf dem Server nicht gefunden.';
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
			return serverExpense
				? 'Gleiche Ausgabe mit gleichem Betrag existiert schon. Prüfe vor dem Senden, ob es ein Duplikat wäre.'
				: 'Auf dem Server nicht gefunden.';
		},
	),
	'recurring.create': serverCheck<{
		recurringExpenses: Array<{ description: string; amountCents: number; nextDueAt: string }>;
	}>('recurring-expenses', (payload, data) => {
		const description = String(payload.description ?? '').trim();
		const amountCents = Number(payload.amountCents ?? 0);
		const serverTemplate = data.recurringExpenses.find(
			(template) =>
				template.description.trim() === description && template.amountCents === amountCents,
		);
		return serverTemplate
			? formatRecurringTemplateConflictNote(serverTemplate)
			: 'Auf dem Server nicht gefunden.';
	}),
	'recurring.advance': serverCheck<{
		recurringExpenses: Array<{ id: string; nextDueAt: string }>;
	}>('recurring-expenses', (payload, data) => {
		const recurringExpenseId = String(payload.recurringExpenseId ?? '');
		const expectedNextDueAt = String(payload.expectedRecurringNextDueAt ?? '');
		const serverTemplate = data.recurringExpenses.find(
			(template) => template.id === recurringExpenseId,
		);
		return serverTemplate
			? formatRecurringAdvanceConflictNote(serverTemplate, expectedNextDueAt)
			: 'Diese Fixkosten-Vorlage existiert serverseitig nicht mehr.';
	}),
};

/** The WG page where the member can look at the entry a queued action targets. */
export function offlineActionInspectHref(shareCode: string, item: OfflineAction): string {
	const module = item.type.startsWith('shopping.')
		? 'einkauf'
		: item.type === 'announcement.create'
			? 'pinnwand'
			: item.type.startsWith('expense.') || item.type.startsWith('recurring.')
				? 'ausgaben'
				: 'putzen';
	return `/wg/${encodeURIComponent(shareCode)}/${module}`;
}

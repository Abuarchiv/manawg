import { parseTimestamp } from '@/core/utils/time';

type RecurringTemplateConflict = {
	description: string;
	amountCents: number;
	nextDueAt: string;
};

type RecurringAdvanceConflict = {
	nextDueAt: string;
};

function formatDueDate(value: string): string {
	const timestamp = parseTimestamp(value);
	return timestamp === null
		? 'Datum unbekannt'
		: new Intl.DateTimeFormat('de-DE', {
				day: 'numeric',
				month: 'numeric',
				year: 'numeric',
			}).format(new Date(timestamp));
}

export function formatRecurringTemplateConflictNote(template: RecurringTemplateConflict): string {
	const dueLabel = formatDueDate(template.nextDueAt);
	const dueSentence = dueLabel.endsWith('.') ? dueLabel : `${dueLabel}.`;
	return `Gleiche Fixkosten-Vorlage existiert schon. Nächste Fälligkeit dort: ${dueSentence} Prüfe vor dem Senden, ob es ein Duplikat wäre.`;
}

export function formatRecurringAdvanceConflictNote(
	template: RecurringAdvanceConflict,
	expectedNextDueAt: string,
): string {
	const serverDue = formatDueDate(template.nextDueAt);
	const expectedDue = formatDueDate(expectedNextDueAt);
	if (template.nextDueAt === expectedNextDueAt) {
		return `Server-Vorlage ist noch auf der erwarteten Fälligkeit ${expectedDue}. Du kannst die Offline-Aktion senden.`;
	}
	return `Server-Vorlage steht inzwischen auf ${serverDue} statt ${expectedDue}. Prüfe vor dem Senden, ob die Fälligkeit schon nachgeholt wurde.`;
}

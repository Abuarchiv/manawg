// Adversarial API checks, part 2: cross-WG access with real ids (IDOR) must be refused.
import {
	absenceId,
	annaId,
	announcementId,
	B,
	benId,
	C,
	choreId,
	cId,
	code,
	codeC,
	commentId,
	eventId,
	exp,
	expenseId,
	inventoryId,
	messageId,
	probe,
	recurringId,
	shoppingId,
	splitId,
} from './fuzz-lib.mjs';
import { call, DAY, expect, iso } from './modules-lib.mjs';

// ---- 3. IDOR: C (other WG) against WG 1 resources, and WG-1 ids used inside WG C
const idor = [];
const check = async (label, u, m, p, body) => {
	const r = await call(u, m, p, body);
	if (r.status < 400)
		idor.push(
			`${label}: ${m} ${p.replace(code, ':code').replace(codeC, ':codeC')} -> ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`,
		);
};
await check('C liest WG1', C, 'GET', `/api/wg/${code}/dashboard`);
await check('C liest WG1-Ausgaben', C, 'GET', `/api/wg/${code}/expenses`);
await check('C liest WG1-Export', C, 'GET', `/api/wg/${code}/export`);
await check('C liest WG1-Chat', C, 'GET', `/api/wg/${code}/chat/messages`);
await check('C ändert WG1-Ausgabe', C, 'PATCH', `/api/wg/${code}/expenses/${expenseId}`, {
	description: 'Gehackt',
});
await check(
	'C ändert WG1-Ausgabe über WG C',
	C,
	'PATCH',
	`/api/wg/${codeC}/expenses/${expenseId}`,
	{ description: 'Gehackt' },
);
await check(
	'C löscht WG1-Ausgabe über WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/expenses/${expenseId}`,
);
await check(
	'C settelt WG1-Split über WG C',
	C,
	'POST',
	`/api/wg/${codeC}/expenses/${expenseId}/splits/${splitId}/settle`,
	{},
);
await check(
	'C hakt WG1-Einkauf über WG C ab',
	C,
	'PATCH',
	`/api/wg/${codeC}/shopping/${shoppingId}`,
	{ done: true },
);
await check(
	'C verbraucht WG1-Vorrat über WG C',
	C,
	'POST',
	`/api/wg/${codeC}/inventory/${inventoryId}/consume`,
	{ delta: -1 },
);
await check('C ändert WG1-Termin über WG C', C, 'PATCH', `/api/wg/${codeC}/events/${eventId}`, {
	title: 'Gehackt',
});
await check(
	'C ändert WG1-Beitrag über WG C',
	C,
	'PATCH',
	`/api/wg/${codeC}/announcements/${announcementId}`,
	{ content: 'Gehackt' },
);
await check(
	'C löscht WG1-Kommentar über WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/announcements/${announcementId}/comments/${commentId}`,
);
await check(
	'C reagiert auf WG1-Beitrag über WG C',
	C,
	'POST',
	`/api/wg/${codeC}/announcements/${announcementId}/reactions`,
	{ reaction: 'ok' },
);
await check(
	'C ändert WG1-Chat über WG C',
	C,
	'PATCH',
	`/api/wg/${codeC}/chat/messages/${messageId}`,
	{ body: 'Gehackt' },
);
await check(
	'C löscht WG1-Chat über WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/chat/messages/${messageId}`,
);
await check(
	'C erledigt WG1-Aufgabe über WG C',
	C,
	'POST',
	`/api/wg/${codeC}/chores/${choreId}/complete`,
	{ completedAt: iso(0) },
);
await check('C löscht WG1-Aufgabe über WG C', C, 'DELETE', `/api/wg/${codeC}/chores/${choreId}`);
await check(
	'C löscht WG1-Abwesenheit über WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/absences/${absenceId}`,
);
await check(
	'C löscht WG1-Fixkosten über WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/recurring-expenses/${recurringId}`,
);
await check(
	'C benennt WG1-Mitglied über WG C um',
	C,
	'PATCH',
	`/api/wg/${codeC}/members/${annaId}`,
	{ name: 'Gehackt' },
);
await check(
	'C macht WG1-Mitglied über WG C zum Admin',
	C,
	'POST',
	`/api/wg/${codeC}/members/${benId}/admin`,
	{},
);
await check('C zieht WG1-Mitglied über WG C aus', C, 'PATCH', `/api/wg/${codeC}/members/${benId}`, {
	active: false,
});
await check('C erinnert WG1-Mitglied über WG C', C, 'POST', `/api/wg/${codeC}/reminders`, {
	toMemberId: benId,
});
await check(
	'C: Ausgabe in WG C mit WG1-Zahler',
	C,
	'POST',
	`/api/wg/${codeC}/expenses`,
	exp(1000, annaId, [cId]),
);
await check(
	'C: Ausgabe in WG C mit WG1-Schuldner',
	C,
	'POST',
	`/api/wg/${codeC}/expenses`,
	exp(1000, cId, [cId, benId]),
);
await check(
	'C: Fixkosten in WG C mit WG1-Schuldner',
	C,
	'POST',
	`/api/wg/${codeC}/recurring-expenses`,
	{
		description: 'X',
		category: 'wohnen',
		amountCents: 1000,
		paidByMemberId: cId,
		intervalMonths: 1,
		nextDueAt: iso(DAY),
		splits: [{ debtorMemberId: benId, amountCents: 1000 }],
	},
);
await check('C: Aufgabe in WG C für WG1-Mitglied', C, 'POST', `/api/wg/${codeC}/chores`, {
	title: 'X',
	intervalDays: 7,
	assignedMemberId: benId,
});
await check('C: Abwesenheit in WG C für WG1-Mitglied', C, 'POST', `/api/wg/${codeC}/absences`, {
	memberId: benId,
	startDate: iso(DAY),
	endDate: iso(2 * DAY),
});
await check(
	'C: Barzahlung in WG C an WG1-Mitglied',
	C,
	'POST',
	`/api/wg/${codeC}/payments/manual`,
	{ fromMemberId: cId, toMemberId: annaId, expectedNetCents: 0 },
);
await check(
	'C: settle-batch in WG C mit WG1-Splits',
	C,
	'POST',
	`/api/wg/${codeC}/expenses/settle-batch`,
	{
		fromMemberId: cId,
		toMemberId: annaId,
		expected: {
			netCents: 0,
			settleableCents: 0,
			splits: [{ id: splitId, amountCents: 1500, offset: 0 }],
		},
	},
);
await check(
	'C: Chat-Antwort in WG C auf WG1-Nachricht',
	C,
	'POST',
	`/api/wg/${codeC}/chat/messages`,
	{ body: 'x', replyToMessageId: messageId },
);
const foreignMention = await call(C, 'POST', `/api/wg/${codeC}/chat/messages`, {
	body: 'x',
	mentionMemberIds: [benId],
});
expect(
	!(foreignMention.body.mentions ?? []).includes(benId),
	'Chat: Erwähnung eines fremden Mitglieds wird verworfen',
	JSON.stringify(foreignMention.body).slice(0, 160),
);
await check(
	'B (Mitglied) ändert fremde Ausgabe-Zahler',
	B,
	'PATCH',
	`/api/wg/${code}/expenses/${expenseId}`,
	{ paidByMemberId: benId },
);
expect(idor.length === 0, 'IDOR: fremde Ids werden abgewiesen', idor.join(' | '));
// Reply to a message of another WG must not leak its text through the reply preview.
const leak = await call(C, 'GET', `/api/wg/${codeC}/chat/messages`);
expect(
	!JSON.stringify(leak.body).includes('"Hi"'),
	'Chat: keine fremde Nachricht in WG C sichtbar',
);

await probe('nach IDOR');

await import('./fuzz-races.mjs');

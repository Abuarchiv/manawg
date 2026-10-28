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
await check('C reads WG1', C, 'GET', `/api/wg/${code}/dashboard`);
await check('C reads WG1 expenses', C, 'GET', `/api/wg/${code}/expenses`);
await check('C reads WG1 export', C, 'GET', `/api/wg/${code}/export`);
await check('C reads WG1 chat', C, 'GET', `/api/wg/${code}/chat/messages`);
await check('C edits WG1 expense', C, 'PATCH', `/api/wg/${code}/expenses/${expenseId}`, {
	description: 'Gehackt',
});
await check('C edits WG1 expense via WG C', C, 'PATCH', `/api/wg/${codeC}/expenses/${expenseId}`, {
	description: 'Gehackt',
});
await check(
	'C deletes WG1 expense via WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/expenses/${expenseId}`,
);
await check(
	'C settles WG1 split via WG C',
	C,
	'POST',
	`/api/wg/${codeC}/expenses/${expenseId}/splits/${splitId}/settle`,
	{},
);
await check(
	'C ticks off WG1 shopping item via WG C',
	C,
	'PATCH',
	`/api/wg/${codeC}/shopping/${shoppingId}`,
	{ done: true },
);
await check(
	'C consumes WG1 supply via WG C',
	C,
	'POST',
	`/api/wg/${codeC}/inventory/${inventoryId}/consume`,
	{ delta: -1 },
);
await check('C edits WG1 event via WG C', C, 'PATCH', `/api/wg/${codeC}/events/${eventId}`, {
	title: 'Gehackt',
});
await check(
	'C edits WG1 post via WG C',
	C,
	'PATCH',
	`/api/wg/${codeC}/announcements/${announcementId}`,
	{ content: 'Gehackt' },
);
await check(
	'C deletes WG1 comment via WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/announcements/${announcementId}/comments/${commentId}`,
);
await check(
	'C reacts to WG1 post via WG C',
	C,
	'POST',
	`/api/wg/${codeC}/announcements/${announcementId}/reactions`,
	{ reaction: 'ok' },
);
await check(
	'C edits WG1 chat via WG C',
	C,
	'PATCH',
	`/api/wg/${codeC}/chat/messages/${messageId}`,
	{ body: 'Gehackt' },
);
await check(
	'C deletes WG1 chat via WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/chat/messages/${messageId}`,
);
await check(
	'C completes WG1 chore via WG C',
	C,
	'POST',
	`/api/wg/${codeC}/chores/${choreId}/complete`,
	{ completedAt: iso(0) },
);
await check('C deletes WG1 chore via WG C', C, 'DELETE', `/api/wg/${codeC}/chores/${choreId}`);
await check(
	'C deletes WG1 absence via WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/absences/${absenceId}`,
);
await check(
	'C deletes WG1 recurring expense via WG C',
	C,
	'DELETE',
	`/api/wg/${codeC}/recurring-expenses/${recurringId}`,
);
await check('C renames WG1 member via WG C', C, 'PATCH', `/api/wg/${codeC}/members/${annaId}`, {
	name: 'Gehackt',
});
await check(
	'C makes WG1 member admin via WG C',
	C,
	'POST',
	`/api/wg/${codeC}/members/${benId}/admin`,
	{},
);
await check('C moves out WG1 member via WG C', C, 'PATCH', `/api/wg/${codeC}/members/${benId}`, {
	active: false,
});
await check('C reminds WG1 member via WG C', C, 'POST', `/api/wg/${codeC}/reminders`, {
	toMemberId: benId,
});
await check(
	'C: expense in WG C with WG1 payer',
	C,
	'POST',
	`/api/wg/${codeC}/expenses`,
	exp(1000, annaId, [cId]),
);
await check(
	'C: expense in WG C with WG1 debtor',
	C,
	'POST',
	`/api/wg/${codeC}/expenses`,
	exp(1000, cId, [cId, benId]),
);
await check(
	'C: recurring expense in WG C with WG1 debtor',
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
await check('C: chore in WG C for WG1 member', C, 'POST', `/api/wg/${codeC}/chores`, {
	title: 'X',
	intervalDays: 7,
	assignedMemberId: benId,
});
await check('C: absence in WG C for WG1 member', C, 'POST', `/api/wg/${codeC}/absences`, {
	memberId: benId,
	startDate: iso(DAY),
	endDate: iso(2 * DAY),
});
await check(
	'C: cash payment in WG C to WG1 member',
	C,
	'POST',
	`/api/wg/${codeC}/payments/manual`,
	{ fromMemberId: cId, toMemberId: annaId, expectedNetCents: 0 },
);
await check(
	'C: settle-batch in WG C with WG1 splits',
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
await check('C: chat reply in WG C to WG1 message', C, 'POST', `/api/wg/${codeC}/chat/messages`, {
	body: 'x',
	replyToMessageId: messageId,
});
const foreignMention = await call(C, 'POST', `/api/wg/${codeC}/chat/messages`, {
	body: 'x',
	mentionMemberIds: [benId],
});
expect(
	!(foreignMention.body.mentions ?? []).includes(benId),
	'Chat: mention of a foreign member is dropped',
	JSON.stringify(foreignMention.body).slice(0, 160),
);
await check(
	'B (member) changes payer of foreign expense',
	B,
	'PATCH',
	`/api/wg/${code}/expenses/${expenseId}`,
	{ paidByMemberId: benId },
);
expect(idor.length === 0, 'IDOR: foreign ids are rejected', idor.join(' | '));
// Reply to a message of another WG must not leak its text through the reply preview.
const leak = await call(C, 'GET', `/api/wg/${codeC}/chat/messages`);
expect(!JSON.stringify(leak.body).includes('"Hi"'), 'Chat: no foreign message visible in WG C');

await probe('after IDOR');

await import('./fuzz-races.mjs');

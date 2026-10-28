// Adversarial API checks, part 1: malformed bodies on every write route and odd path ids must
// never answer 5xx. Shared fixtures in fuzz-lib.mjs; continues with fuzz-access.mjs and fuzz-races.mjs.
import { randomUUID } from 'node:crypto';
import {
	A,
	absenceId,
	annaId,
	announcementId,
	benId,
	choreId,
	code,
	commentId,
	eventId,
	exp,
	expenseId,
	fuzzBodies,
	ids,
	inventoryId,
	messageId,
	probe,
	recurringId,
	shoppingId,
	splitId,
} from './fuzz-lib.mjs';
import { call, DAY, expect, iso, user } from './modules-lib.mjs';

// ---- 1. malformed bodies: 4xx only
const writes = [
	['POST', '/api/wg', { name: 'Neu', creatorName: 'Anna' }],
	['PATCH', `/api/wg/${code}`, { name: 'Neu' }],
	['POST', `/api/wg/${code}/expenses`, exp(1000, annaId, [annaId, benId])],
	['PATCH', `/api/wg/${code}/expenses/${expenseId}`, { description: 'Neu', amountCents: 3000 }],
	['POST', `/api/wg/${code}/expenses/${expenseId}/splits/${splitId}/settle`, {}],
	[
		'POST',
		`/api/wg/${code}/expenses/settle-batch`,
		{
			fromMemberId: benId,
			toMemberId: annaId,
			expected: { netCents: 1500, settleableCents: 1500, splits: [] },
		},
	],
	[
		'POST',
		`/api/wg/${code}/payments/manual`,
		{ fromMemberId: benId, toMemberId: annaId, expectedNetCents: 1500 },
	],
	[
		'POST',
		`/api/wg/${code}/recurring-expenses`,
		{
			description: 'Strom',
			category: 'wohnen',
			amountCents: 1000,
			paidByMemberId: annaId,
			intervalMonths: 1,
			nextDueAt: iso(DAY),
			splits: [
				{ debtorMemberId: annaId, amountCents: 500 },
				{ debtorMemberId: benId, amountCents: 500 },
			],
		},
	],
	['PATCH', `/api/wg/${code}/recurring-expenses/${recurringId}`, { description: 'Miete 2' }],
	['POST', `/api/wg/${code}/shopping`, { name: 'Brot', quantity: '1' }],
	['PATCH', `/api/wg/${code}/shopping/${shoppingId}`, { name: 'Brot', done: true }],
	[
		'POST',
		`/api/wg/${code}/inventory`,
		{ name: 'Spüli', quantity: 1, threshold: 1, category: 'putzmittel' },
	],
	['PATCH', `/api/wg/${code}/inventory/${inventoryId}`, { quantity: 3 }],
	['POST', `/api/wg/${code}/inventory/${inventoryId}/consume`, { delta: -1 }],
	[
		'POST',
		`/api/wg/${code}/events`,
		{ title: 'T', startsAt: iso(DAY), endsAt: iso(DAY + 1000), recurrence: 'FREQ=WEEKLY' },
	],
	[
		'PATCH',
		`/api/wg/${code}/events/${eventId}`,
		{ title: 'T2', startsAt: iso(DAY), endsAt: iso(DAY + 1000) },
	],
	[
		'POST',
		`/api/wg/${code}/events/${eventId}/occurrence`,
		{ action: 'cancel', occurrenceStartsAt: iso(DAY) },
	],
	['POST', `/api/wg/${code}/announcements`, { content: 'A', kind: 'info' }],
	['PATCH', `/api/wg/${code}/announcements/${announcementId}`, { content: 'B' }],
	['POST', `/api/wg/${code}/announcements/${announcementId}/comments`, { content: 'C' }],
	[
		'PATCH',
		`/api/wg/${code}/announcements/${announcementId}/comments/${commentId}`,
		{ content: 'D' },
	],
	['POST', `/api/wg/${code}/announcements/${announcementId}/reactions`, { reaction: 'ok' }],
	[
		'POST',
		`/api/wg/${code}/chat/messages`,
		{ body: 'Hi', replyToMessageId: messageId, mentionMemberIds: [benId] },
	],
	['PATCH', `/api/wg/${code}/chat/messages/${messageId}`, { body: 'Hi2' }],
	['POST', `/api/wg/${code}/chat/messages/${messageId}/reactions`, { emoji: '👍' }],
	['POST', `/api/wg/${code}/chat/read`, { lastReadMessageId: messageId }],
	['POST', `/api/wg/${code}/chores`, { title: 'Küche', intervalDays: 7, assignedMemberId: annaId }],
	['PATCH', `/api/wg/${code}/chores/${choreId}`, { title: 'Bad 2', intervalDays: 3 }],
	['POST', `/api/wg/${code}/chores/${choreId}/complete`, { completedAt: iso(0) }],
	[
		'POST',
		`/api/wg/${code}/absences`,
		{ memberId: annaId, startDate: iso(3 * DAY), endDate: iso(4 * DAY), reason: 'Urlaub' },
	],
	['PATCH', `/api/wg/${code}/absences/${absenceId}`, { endDate: iso(5 * DAY) }],
	['PATCH', `/api/wg/${code}/members/${annaId}`, { name: 'Anna', expectedName: 'Anna' }],
	[
		'PATCH',
		`/api/wg/${code}/notifications`,
		{ notifyChat: true, quietStartHour: 22, quietEndHour: 7 },
	],
	['POST', `/api/wg/${code}/invites`, {}],
	['POST', `/api/wg/${code}/invitations`, { email: 'x@example.test' }],
	['POST', `/api/wg/${code}/reminders`, { toMemberId: benId }],
	['POST', `/api/wg/${code}/calendar-subscription`, {}],
	['POST', `/api/wg/${code}/imports/preview`, { source: 'splitwise', csv: 'a,b\n1,2' }],
	['POST', `/api/wg/${code}/imports/commit`, { previewId: randomUUID(), rows: [] }],
	['POST', '/api/upload/sign', { contentType: 'image/png', size: 100, wgCode: code }],
	[
		'POST',
		'/api/auth/sign-up',
		{ email: 'x@example.test', password: 'Sicheres-Passwort-77', name: 'X' },
	],
	['POST', '/api/auth/sign-in', { email: 'x@example.test', password: 'p' }],
	['POST', '/api/auth/code-request', { email: 'x@example.test' }],
	['POST', '/api/auth/code-verify', { email: 'x@example.test', code: '12345678' }],
	['POST', '/api/auth/email', { email: 'y@example.test' }],
	['POST', '/api/auth/password', { password: 'Sicheres-Passwort-99' }],
	['POST', '/api/auth/password-reset', { email: 'x@example.test' }],
	['POST', '/api/auth/resend', { email: 'x@example.test' }],
	['POST', '/api/auth/identity-link', { provider: 'google' }],
	['POST', '/api/auth/oauth-start', { provider: 'google', next: '/neu' }],
	['POST', '/api/email/unsubscribe', { token: 'abc' }],
];
// Auth routes swap the session cookie (sign-up, code-verify): fuzz them from a throwaway account.
const D = await user('Dummy');
let fuzzCalls = 0;
const fiveHundreds = new Map();
for (const [method, path, base] of writes) {
	const who = path.startsWith('/api/auth/') ? D : A;
	const bodies = fuzzBodies(base);
	for (const body of bodies) {
		fuzzCalls++;
		const r = await call(who, method, path, body);
		if (r.status >= 500) {
			const key = `${method} ${path.replace(code, ':code').replace(/[0-9a-f-]{36}/g, ':id')}`;
			if (!fiveHundreds.has(key))
				fiveHundreds.set(
					key,
					`${r.status} body=${JSON.stringify(body).slice(0, 120)} -> ${JSON.stringify(r.body).slice(0, 160)}`,
				);
		}
	}
	// raw non-JSON payloads
	for (const raw of ['', '{', 'null', '[]', '"x"', '{"a":1}'.repeat(20000)]) {
		fuzzCalls++;
		const res = await who.ctx.fetch(path, {
			method,
			data: raw,
			headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
		});
		if (res.status() >= 500)
			fiveHundreds.set(`${method} ${path} raw=${raw.slice(0, 10)}`, String(res.status()));
	}
}
expect(
	fiveHundreds.size === 0,
	`Fuzz: keine 5xx (${fuzzCalls} Aufrufe)`,
	[...fiveHundreds].map(([k, v]) => `${k}: ${v}`).join(' | '),
);

await probe('nach Fuzz-Bodies');
// ---- 2. odd ids in paths
let idCalls = 0;
const idFails = [];
for (const id of ids) {
	for (const [m, p] of [
		['GET', `/api/wg/${code}/expenses/${id}`],
		['PATCH', `/api/wg/${code}/expenses/${id}`],
		['DELETE', `/api/wg/${code}/expenses/${id}`],
		['POST', `/api/wg/${code}/expenses/${id}/splits/${id}/settle`],
		['PATCH', `/api/wg/${code}/shopping/${id}`],
		['DELETE', `/api/wg/${code}/inventory/${id}`],
		['POST', `/api/wg/${code}/inventory/${id}/consume`],
		['PATCH', `/api/wg/${code}/events/${id}`],
		['POST', `/api/wg/${code}/events/${id}/occurrence`],
		['PATCH', `/api/wg/${code}/announcements/${id}`],
		['DELETE', `/api/wg/${code}/announcements/${id}/comments/${id}`],
		['POST', `/api/wg/${code}/announcements/${id}/reactions`],
		['PATCH', `/api/wg/${code}/chat/messages/${id}`],
		['POST', `/api/wg/${code}/chat/messages/${id}/reactions`],
		['POST', `/api/wg/${code}/chores/${id}/complete`],
		['DELETE', `/api/wg/${code}/absences/${id}`],
		['PATCH', `/api/wg/${code}/members/${id}`],
		['POST', `/api/wg/${code}/members/${id}/admin`],
		['POST', `/api/wg/${code}/members/${id}/claim`],
		['DELETE', `/api/wg/${code}/invites/${id}`],
		['GET', `/api/wg/invites/${id}`],
		['GET', `/api/wg/${code}/imports/${id}`],
		['DELETE', `/api/wg/${code}/recurring-expenses/${id}`],
		['GET', `/api/calendar/${id}/${id}`],
		['GET', `/api/wg/${id}/dashboard`],
		['GET', `/api/wg/${id}`],
	]) {
		idCalls++;
		const r = await call(
			A,
			m,
			p,
			m === 'GET'
				? undefined
				: {
						delta: -1,
						name: 'x',
						content: 'x',
						action: 'cancel',
						occurrenceStartsAt: iso(DAY),
						reaction: 'ok',
						emoji: '👍',
					},
		);
		if (r.status >= 500) idFails.push(`${m} ${p.slice(0, 80)} -> ${r.status}`);
	}
}
expect(idFails.length === 0, `Pfad-IDs: keine 5xx (${idCalls} Aufrufe)`, idFails.join(' | '));

await import('./fuzz-access.mjs');

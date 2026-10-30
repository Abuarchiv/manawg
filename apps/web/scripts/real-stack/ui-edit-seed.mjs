// Seed for ui-edit.mjs: one row per module so lists, sheets and edit controls render.
import { call, DAY, iso } from './modules-lib.mjs';

export async function seed({ A, B, code, annaId, benId, LONG }) {
	const api = `/api/wg/${code}`;
	await call(A, 'POST', `${api}/expenses`, {
		amountCents: 4250,
		description: 'Wocheneinkauf',
		category: 'groceries',
		paidByMemberId: annaId,
		splits: [
			{ debtorMemberId: annaId, amountCents: 2125 },
			{ debtorMemberId: benId, amountCents: 2125 },
		],
	});
	await call(A, 'POST', `${api}/shopping`, { name: 'Hafermilch', quantity: '2' });
	await call(A, 'POST', `${api}/inventory`, {
		name: 'Klopapier',
		quantity: 1,
		threshold: 2,
		category: 'cleaning',
	});
	await call(A, 'POST', `${api}/chores`, {
		title: 'Bad putzen',
		intervalDays: 7,
		assignedMemberId: annaId,
	});
	await call(A, 'POST', `${api}/events`, {
		title: 'Hausversammlung',
		startsAt: iso(DAY),
		endsAt: iso(DAY + 3_600_000),
	});
	await call(A, 'POST', `${api}/announcements`, {
		content: 'Wer hat den Schlüssel?',
		kind: 'info',
	});
	await call(A, 'POST', `${api}/chat/messages`, { body: 'Hallo zusammen' });
	await call(B, 'POST', `${api}/chat/messages`, { body: LONG.repeat(4).slice(0, 600) });
	await call(A, 'POST', `${api}/recurring-expenses`, {
		description: 'Internet',
		category: 'housing',
		amountCents: 4000,
		paidByMemberId: annaId,
		intervalMonths: 1,
		nextDueAt: iso(5 * DAY),
		splits: [
			{ debtorMemberId: annaId, amountCents: 2000 },
			{ debtorMemberId: benId, amountCents: 2000 },
		],
	});
}

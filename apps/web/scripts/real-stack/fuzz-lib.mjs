// Shared setup for the fuzz scripts: two households, odd inputs, one fixture per resource.
// Importing this module creates the data; fuzz.mjs runs the parts in order.
// Needs the same env as modules.mjs.
import { randomUUID } from 'node:crypto';
import { call, DAY, expect, iso, setup } from './modules-lib.mjs';

export const { A, B, code, annaId, benId } = await setup();
// A second household with its own member: ids from here must never work inside the first one.
export const other = await setup();
export const C = other.A;
export const codeC = other.code;
export const cId = other.annaId;

export const long = 'x'.repeat(5000);
export const weird = [
	'',
	' ',
	'\u0000',
	'🙂'.repeat(300),
	'‮ rtl',
	'<script>alert(1)</script>',
	"' OR 1=1 --",
];
export const junkBodies = [
	null,
	[],
	'str',
	123,
	true,
	{ __proto__: { polluted: true } },
	{ constructor: { prototype: { x: 1 } } },
];
export const numbers = [
	-1,
	0,
	0.5,
	1e12,
	2147483648,
	Number.MAX_SAFE_INTEGER,
	Number.NaN,
	'abc',
	'12',
	[],
	{},
];
export const ids = [
	'abc',
	// Encoded: the plain form is resolved by the client to DELETE /api/wg/:code (the admin deleting their WG).
	'..%2F..',
	randomUUID(),
	'00000000-0000-0000-0000-000000000000',
	long.slice(0, 300),
];
export const dates = ['', 'gestern', '2026-02-30T00:00:00Z', '99999-01-01', 1, true, '2026-13-01'];

export function fuzzBodies(base) {
	const out = [...junkBodies, {}];
	for (const key of Object.keys(base)) {
		const value = base[key];
		for (const w of weird) out.push({ ...base, [key]: w });
		out.push(
			{ ...base, [key]: long },
			{ ...base, [key]: null },
			{ ...base, [key]: [] },
			{ ...base, [key]: {} },
		);
		if (typeof value === 'number') for (const n of numbers) out.push({ ...base, [key]: n });
		if (typeof value === 'string' && /At$|Date$/.test(key))
			for (const d of dates) out.push({ ...base, [key]: d });
		if (Array.isArray(value))
			out.push(
				{ ...base, [key]: [null] },
				{ ...base, [key]: [{}] },
				{ ...base, [key]: new Array(500).fill(value[0]) },
			);
	}
	return out;
}

export const exp = (amt, payer, members) => ({
	amountCents: amt,
	description: 'Fuzz',
	category: 'groceries',
	paidByMemberId: payer,
	splits: members.map((id, i) => ({
		debtorMemberId: id,
		amountCents: Math.floor(amt / members.length) + (i < amt % members.length ? 1 : 0),
	})),
});

// ---- resources to fuzz against
export const x = await call(
	A,
	'POST',
	`/api/wg/${code}/expenses`,
	exp(3000, annaId, [annaId, benId]),
);
export const expenseId = x.body.expense?.id;
export const splitId =
	x.body.expense?.splits?.find((s) => s.debtorMemberId === benId)?.id ??
	x.body.splits?.find((s) => s.debtorMemberId === benId)?.id;
export const sh = await call(A, 'POST', `/api/wg/${code}/shopping`, {
	name: 'Milch',
	quantity: '1',
});
export const shoppingId = (sh.body.item ?? sh.body).id;
export const iv = await call(A, 'POST', `/api/wg/${code}/inventory`, {
	name: 'Seife',
	quantity: 5,
	threshold: 1,
	category: 'cleaning',
});
export const inventoryId = (iv.body.item ?? iv.body).id;
export const ev = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Treffen',
	startsAt: iso(DAY),
	endsAt: iso(DAY + 3_600_000),
});
export const eventId = (ev.body.event ?? ev.body).id;
export const an = await call(A, 'POST', `/api/wg/${code}/announcements`, {
	content: 'Hallo',
	kind: 'info',
});
export const announcementId = (an.body.announcement ?? an.body).id;
export const cm = await call(
	A,
	'POST',
	`/api/wg/${code}/announcements/${announcementId}/comments`,
	{
		content: 'Ja',
	},
);
export const commentId = (cm.body.comment ?? cm.body).id;
export const ch = await call(A, 'POST', `/api/wg/${code}/chores`, {
	title: 'Bad',
	intervalDays: 7,
	assignedMemberId: annaId,
});
export const choreId = (ch.body.chore ?? ch.body).id;
export const ab = await call(A, 'POST', `/api/wg/${code}/absences`, {
	memberId: annaId,
	startDate: iso(DAY),
	endDate: iso(2 * DAY),
});
export const absenceId = (ab.body.absence ?? ab.body).id;
export const re = await call(A, 'POST', `/api/wg/${code}/recurring-expenses`, {
	description: 'Miete',
	category: 'housing',
	amountCents: 4000,
	paidByMemberId: annaId,
	intervalMonths: 1,
	nextDueAt: iso(DAY),
	splits: [
		{ debtorMemberId: annaId, amountCents: 2000 },
		{ debtorMemberId: benId, amountCents: 2000 },
	],
});
export const recurringId = (re.body.recurringExpense ?? re.body).id;
export const msg = await call(A, 'POST', `/api/wg/${code}/chat/messages`, { body: 'Hi' });
export const messageId = (msg.body.message ?? msg.body).id;
for (const [k, v] of Object.entries({
	expenseId,
	splitId,
	shoppingId,
	inventoryId,
	eventId,
	announcementId,
	commentId,
	choreId,
	absenceId,
	recurringId,
	messageId,
}))
	expect(Boolean(v), `Fixture ${k}`, JSON.stringify({ x: x.body, msg: msg.body }).slice(0, 300));

export const probe = async (label) => {
	const d = await call(A, 'GET', `/api/wg/${code}/dashboard`);
	process.stdout.write(
		`probe ${label}: dashboard ${d.status} ${d.status !== 200 ? JSON.stringify(d.body).slice(0, 120) : ''}\n`,
	);
};

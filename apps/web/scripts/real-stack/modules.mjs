// Module-level API checks against the local real stack (see README), part 1: shopping,
// inventory, events, calendar subscription, expenses, settlement, manual payments, recurring
// expenses with the cron. Continues with modules-admin.mjs (one summary at the end).
import { BASE, CRON, call, DAY, expect, iso, setup, sql, VERBOSE } from './modules-lib.mjs';

const { A, B, code, annaId, benId } = await setup();

// ---- Shopping
const s1 = await call(A, 'POST', `/api/wg/${code}/shopping`, { name: 'Hafermilch', quantity: '2' });
expect(s1.status < 300, 'Shopping: create item', JSON.stringify(s1.body));
const sItem = s1.body.item ?? s1.body;
const sList = await call(B, 'GET', `/api/wg/${code}/shopping`);
expect(
	JSON.stringify(sList.body).includes('Hafermilch'),
	'Shopping: B sees item',
	JSON.stringify(sList.body).slice(0, 200),
);
const s2 = await call(B, 'PATCH', `/api/wg/${code}/shopping/${sItem.id}`, {
	bought: true,
	expectedUpdatedAt: sItem.updatedAt,
	expectedBoughtAt: null,
});
expect(s2.status < 300, 'Shopping: tick off', JSON.stringify(s2.body));
const s3 = await call(A, 'PATCH', `/api/wg/${code}/shopping/${sItem.id}`, {
	name: 'Sojamilch',
	expectedUpdatedAt: sItem.updatedAt,
	expectedBoughtAt: null,
});
expect(s3.status === 409, 'Shopping: stale state = 409', JSON.stringify(s3));
const s4 = await call(A, 'DELETE', `/api/wg/${code}/shopping/${sItem.id}`);
expect(s4.status < 300, 'Shopping: delete', JSON.stringify(s4.body));
expect(
	+sql(`select count(*) from shopping_items where id='${sItem.id}'`) === 0,
	'Shopping: gone from DB',
);

// ---- Inventory
const i1 = await call(A, 'POST', `/api/wg/${code}/inventory`, {
	name: 'Klopapier',
	quantity: 5,
	threshold: 2,
	category: 'cleaning',
});
expect(i1.status < 300, 'Inventory: create', JSON.stringify(i1.body));
const invItem = i1.body.item ?? i1.body;
const iDup = await call(B, 'POST', `/api/wg/${code}/inventory`, { name: 'klopapier' });
expect(iDup.status === 409, 'Inventory: duplicate (case-insensitive) = 409', JSON.stringify(iDup));
const c1 = await call(B, 'POST', `/api/wg/${code}/inventory/${invItem.id}/consume`, { delta: -4 });
expect(c1.status < 300, 'Inventory: consume', JSON.stringify(c1.body));
expect(
	c1.body.item?.quantity === 1 && c1.body.autoPushedShoppingItemId,
	'Inventory: below threshold → shopping list',
	JSON.stringify(c1.body),
);
const c2 = await call(B, 'POST', `/api/wg/${code}/inventory/${invItem.id}/consume`, { delta: -9 });
expect(
	c2.status < 300 && c2.body.item?.quantity === 0 && c2.body.clamped === true,
	'Inventory: never negative (clamped)',
	JSON.stringify(c2.body),
);
const i2 = await call(A, 'PATCH', `/api/wg/${code}/inventory/${invItem.id}`, {
	quantity: 10,
	expectedQuantity: 0,
	expectedUpdatedAt: c2.body.item?.updatedAt,
});
expect(i2.status < 300, 'Inventory: restock', JSON.stringify(i2.body));
const i3 = await call(A, 'DELETE', `/api/wg/${code}/inventory/${invItem.id}`);
expect(i3.status < 300, 'Inventory: delete', JSON.stringify(i3.body));

// ---- Events
const e1 = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Hausversammlung',
	startsAt: iso(2 * DAY),
	endsAt: iso(2 * DAY + 3_600_000),
	location: 'Küche',
	description: null,
});
expect(e1.status < 300, 'Calendar: create event', JSON.stringify(e1.body));
const ev = e1.body.event ?? e1.body;
const eBad = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Falsch',
	startsAt: iso(2 * DAY),
	endsAt: iso(DAY),
});
expect(eBad.status === 400, 'Calendar: end before start = 400', JSON.stringify(eBad));
const e2x = await call(B, 'PATCH', `/api/wg/${code}/events/${ev.id}`, { title: 'Gehackt' });
expect(e2x.status === 403, 'Calendar: others cannot edit', JSON.stringify(e2x));
const e2 = await call(A, 'PATCH', `/api/wg/${code}/events/${ev.id}`, { title: 'WG-Versammlung' });
expect(e2.status < 300, 'Calendar: rename', JSON.stringify(e2.body));
const er = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Putztag',
	startsAt: iso(DAY),
	allDay: true,
	recurrence: 'FREQ=WEEKLY',
});
expect(er.status < 300, 'Calendar: create series', JSON.stringify(er.body));
const series = er.body.event ?? er.body;
const list = await call(B, 'GET', `/api/wg/${code}/events?from=${iso(0)}&to=${iso(30 * DAY)}`);
expect(list.status === 200, 'Calendar: list', JSON.stringify(list.body).slice(0, 200));
const occStart = series.startsAt ?? iso(DAY);
const oc = await call(A, 'POST', `/api/wg/${code}/events/${series.id}/occurrence`, {
	action: 'cancel',
	occurrenceStartsAt: occStart,
});
expect(
	oc.status < 300,
	'Calendar: cancel single occurrence of the series',
	JSON.stringify(oc.body),
);
const e3 = await call(A, 'DELETE', `/api/wg/${code}/events/${ev.id}`);
expect(e3.status < 300, 'Calendar: delete', JSON.stringify(e3.body));

// ---- Calendar subscription
const cs = await call(A, 'POST', `/api/wg/${code}/calendar-subscription`, {});
expect(cs.status < 300, 'Calendar subscription: create', JSON.stringify(cs.body));
const feed = cs.body.subscription?.feedUrl ?? cs.body.feedUrl ?? '';
if (feed) {
	const ics = await fetch(feed.startsWith('http') ? feed : `${BASE}${feed}`);
	const text = await ics.text();
	expect(
		ics.status === 200 && text.includes('BEGIN:VCALENDAR'),
		'Calendar subscription: ICS loads',
		`${ics.status} ${text.slice(0, 120)}`,
	);
	expect(text.includes('Putztag'), 'Calendar subscription: series in feed', text.slice(0, 300));
} else {
	bugs.push(
		`Calendar subscription: no URL in response :: ${JSON.stringify(cs.body).slice(0, 200)}`,
	);
}
const csDel = await call(A, 'DELETE', `/api/wg/${code}/calendar-subscription`);
expect(csDel.status < 300, 'Calendar subscription: delete', JSON.stringify(csDel.body));
if (feed) {
	const gone = await fetch(feed.startsWith('http') ? feed : `${BASE}${feed}`);
	expect(
		gone.status >= 400,
		'Calendar subscription: feed blocked after delete',
		String(gone.status),
	);
}

// ---- Expenses, settlement, manual payment
const ex = async (u, amt, payer, ids) =>
	call(u, 'POST', `/api/wg/${code}/expenses`, {
		amountCents: amt,
		description: 'Einkauf',
		category: 'groceries',
		paidByMemberId: payer,
		splits: ids.map((id, i) => ({
			debtorMemberId: id,
			amountCents: Math.floor(amt / ids.length) + (i < amt % ids.length ? 1 : 0),
		})),
	});
const x1 = await ex(A, 6000, annaId, [annaId, benId]); // Ben owes Anna 30
const x2 = await ex(B, 2000, benId, [annaId, benId]); // Anna owes Ben 10 → net Ben owes Anna 20
expect(x1.status < 300 && x2.status < 300, 'Create expenses', `${x1.status} ${x2.status}`);
const dash = await call(B, 'GET', `/api/wg/${code}/dashboard`);
expect(dash.status === 200, 'Dashboard', JSON.stringify(dash.body).slice(0, 200));
const bal = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
expect(
	bal.body.balances?.some((b) => b.amount_cents === 2000),
	'Balance: Ben owes Anna 20 €',
	JSON.stringify(bal.body),
);
const settlement = await call(
	B,
	'GET',
	`/api/wg/${code}/expenses/settle-batch?fromMemberId=${benId}&toMemberId=${annaId}`,
);
expect(
	settlement.status === 200,
	'Settlement: overview',
	JSON.stringify(settlement.body).slice(0, 300),
);
if (VERBOSE) process.stdout.write(`settlement ${JSON.stringify(settlement.body).slice(0, 1500)}\n`);
// Manual payment: wrong expected net must be refused, right one books it.
const pmBad = await call(B, 'POST', `/api/wg/${code}/payments/manual`, {
	fromMemberId: benId,
	toMemberId: annaId,
	expectedNetCents: 1500,
});
expect(pmBad.status === 409, 'Cash payment: stale balance = 409', JSON.stringify(pmBad));
const pm = await call(B, 'POST', `/api/wg/${code}/payments/manual`, {
	fromMemberId: benId,
	toMemberId: annaId,
	expectedNetCents: 2000,
});
expect(pm.status < 300, 'Cash payment: book 20 €', JSON.stringify(pm.body));
const bal2 = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
expect(
	(bal2.body.balances ?? []).every((b) => b.amount_cents === 0) ||
		(bal2.body.balances ?? []).length === 0,
	'Balance after cash payment: 0',
	JSON.stringify(bal2.body),
);
expect(
	+sql(
		`select count(*) from expense_payments where wg_id=(select id from wgs where share_code='${code}') and status='completed' and amount_cents=2000`,
	) === 1,
	'Cash payment in DB (completed, 2000)',
);
const pmAgain = await call(B, 'POST', `/api/wg/${code}/payments/manual`, {
	fromMemberId: benId,
	toMemberId: annaId,
	expectedNetCents: 2000,
});
expect(pmAgain.status === 409, 'Cash payment: duplicate = 409', JSON.stringify(pmAgain));
// Fresh debt and settle-batch with the reviewed snapshot
const x3 = await ex(A, 1000, annaId, [benId]); // Ben owes Anna 10
expect(x3.status < 300, '10 € expense for Ben only', JSON.stringify(x3.body));
const st2 = await call(
	B,
	'GET',
	`/api/wg/${code}/expenses/settle-batch?fromMemberId=${benId}&toMemberId=${annaId}`,
);
const d2 =
	st2.body.netCents !== undefined ? st2.body : (st2.body.settlement ?? st2.body.debt ?? null);
expect(
	d2 && d2.netCents === 1000,
	'Settlement: open balance 10 €',
	JSON.stringify(st2.body).slice(0, 400),
);
if (d2) {
	const sb = await call(B, 'POST', `/api/wg/${code}/expenses/settle-batch`, {
		fromMemberId: benId,
		toMemberId: annaId,
		expected: {
			netCents: d2.netCents,
			settleableCents: d2.settleableCents,
			splits: d2.splits.map(({ id, amountCents, offset }) => ({
				id,
				amountCents,
				offset: !!offset,
			})),
		},
	});
	expect(sb.status < 300, 'Settlement: confirm settle', JSON.stringify(sb.body));
	const sbAgain = await call(B, 'POST', `/api/wg/${code}/expenses/settle-batch`, {
		fromMemberId: benId,
		toMemberId: annaId,
		expected: {
			netCents: d2.netCents,
			settleableCents: d2.settleableCents,
			splits: d2.splits.map(({ id, amountCents, offset }) => ({
				id,
				amountCents,
				offset: !!offset,
			})),
		},
	});
	expect(
		sbAgain.status === 409 || sbAgain.status === 400,
		'Settlement: second settle rejected',
		JSON.stringify(sbAgain),
	);
	const bal3 = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
	expect(
		(bal3.body.balances ?? []).every((b) => b.amount_cents === 0) ||
			(bal3.body.balances ?? []).length === 0,
		'Balance after settle: 0',
		JSON.stringify(bal3.body),
	);
}
const delSettled = await call(A, 'DELETE', `/api/wg/${code}/expenses/${x1.body.expense?.id}`);
expect(
	delSettled.status < 300,
	'Expense deletable after cash payment (payment stays as credit)',
	JSON.stringify(delSettled.body),
);
const delSettledSplit = await call(A, 'DELETE', `/api/wg/${code}/expenses/${x3.body.expense?.id}`);
expect(
	delSettledSplit.status === 409,
	'Expense with settled share not deletable',
	JSON.stringify(delSettledSplit),
);
const xe = await call(B, 'PATCH', `/api/wg/${code}/expenses/${x2.body.expense?.id}`, {
	description: 'Getränke',
});
expect(xe.status < 300 || xe.status === 409, 'Edit expense', JSON.stringify(xe.body));
const xStranger = await call(B, 'PATCH', `/api/wg/${code}/expenses/${x1.body.expense?.id}`, {
	description: 'fremd',
});
expect(xStranger.status >= 400, 'foreign expense not editable', JSON.stringify(xStranger));

// ---- Recurring + cron
const rc = await call(A, 'POST', `/api/wg/${code}/recurring-expenses`, {
	description: 'Internet',
	category: 'housing',
	amountCents: 4000,
	paidByMemberId: annaId,
	intervalMonths: 1,
	nextDueAt: iso(-DAY),
	splits: [
		{ debtorMemberId: annaId, amountCents: 2000 },
		{ debtorMemberId: benId, amountCents: 2000 },
	],
});
expect(rc.status < 300, 'Recurring: create template', JSON.stringify(rc.body));
const rec = rc.body.recurringExpense ?? rc.body;
const cronNoAuth = await fetch(`${BASE}/api/cron/recurring-advance`);
expect(cronNoAuth.status === 401, 'Cron without secret = 401', String(cronNoAuth.status));
const cron = await fetch(`${BASE}/api/cron/recurring-advance`, {
	headers: { authorization: `Bearer ${CRON}` },
});
expect(
	cron.status === 200,
	'Recurring cron runs',
	`${cron.status} ${(await cron.text()).slice(0, 200)}`,
);
expect(
	+sql(
		`select count(*) from expenses where description='Internet' and wg_id=(select id from wgs where share_code='${code}')`,
	) === 1,
	'Recurring: cron booked exactly one expense',
);
const cron2 = await fetch(`${BASE}/api/cron/recurring-advance`, {
	headers: { authorization: `Bearer ${CRON}` },
});
expect(cron2.status === 200, 'Cron second run ok');
expect(
	+sql(
		`select count(*) from expenses where description='Internet' and wg_id=(select id from wgs where share_code='${code}')`,
	) === 1,
	'Recurring: second cron run does not book twice',
);
const recNow = await call(A, 'GET', `/api/wg/${code}/recurring-expenses`);
const recRow =
	(recNow.body.recurringExpenses ?? recNow.body.items ?? []).find((r) => r.id === rec.id) ?? rec;
const rp = await call(A, 'PATCH', `/api/wg/${code}/recurring-expenses/${rec.id}`, {
	paused: true,
	expectedNextDueAt: recRow.nextDueAt,
});
expect(rp.status < 300, 'Recurring: pause', JSON.stringify(rp.body));
const rpB = await call(B, 'PATCH', `/api/wg/${code}/recurring-expenses/${rec.id}`, {
	amountCents: 1,
	expectedNextDueAt: recRow.nextDueAt,
});
expect(
	rpB.status === 403 || rpB.status === 400,
	'Recurring: others cannot edit',
	JSON.stringify(rpB),
);
const rd = await call(A, 'DELETE', `/api/wg/${code}/recurring-expenses/${rec.id}`);
expect(rd.status < 300, 'Recurring: delete', JSON.stringify(rd.body));

await import('./modules-admin.mjs');

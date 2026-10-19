import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';

// Module-level API checks against the local real stack (see README): shopping, inventory, events,
// payments and settlement, recurring expenses with the cron, pinnwand, absences, members, calendar
// subscription, export, crons, WG rename and deletion, account deletion.
const BASE = 'http://localhost:3140';
const SB = 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CRON = process.env.CRON_SECRET ?? '';
if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (see supabase status -o env)');
if (!CRON) throw new Error('CRON_SECRET missing (same value the server runs with)');
const VERBOSE = process.env.VERBOSE === '1';
const sql = (q) =>
	execSync(
		`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -Atc "${q.replace(/"/g, '\\"')}"`,
	)
		.toString()
		.trim();
const stamp = Date.now();
const bugs = [];
const oks = [];
const expect = (c, m, extra = '') => {
	if (c) oks.push(m);
	else bugs.push(m + (extra ? ` :: ${String(extra).slice(0, 300)}` : ''));
};
const show = (label, r) => {
	if (VERBOSE)
		process.stdout.write(`${label} ${r.status} ${JSON.stringify(r.body).slice(0, 400)}\n`);
};
async function user(name) {
	const email = `${name.toLowerCase()}${stamp}@example.test`;
	const password = 'Sicheres-Passwort-77';
	const r = await fetch(`${SB}/auth/v1/admin/users`, {
		method: 'POST',
		headers: {
			apikey: SERVICE,
			authorization: `Bearer ${SERVICE}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			email,
			password,
			email_confirm: true,
			user_metadata: { full_name: name },
		}),
	});
	const u = await r.json();
	const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
	const s = await ctx.post('/api/auth/sign-in', { data: { email, password } });
	if (!s.ok()) throw new Error(`signin ${name} ${s.status()}${await s.text()}`);
	return { name, id: u.id, email, ctx };
}
const j = async (res) => {
	try {
		return await res.json();
	} catch {
		return {};
	}
};
const call = async (u, method, path, data, headers = {}) => {
	const res = await u.ctx.fetch(path, {
		method,
		data,
		headers: {
			'content-type': 'application/json',
			...(method !== 'GET' ? { 'idempotency-key': randomUUID() } : {}),
			...headers,
		},
	});
	const out = { status: res.status(), body: await j(res), headers: res.headers() };
	show(`${method} ${path}`, out);
	return out;
};
const iso = (offsetMs) => new Date(stamp + offsetMs).toISOString();
const DAY = 86_400_000;

const A = await user('Anna');
const B = await user('Ben');

const w = await call(A, 'POST', '/api/wg', { name: 'Modulwohnung', creatorName: 'Anna' });
expect(w.status < 300, 'WG erstellen', JSON.stringify(w.body));
const code = w.body.wg?.shareCode;
const annaId = w.body.creator?.id;
const inv = await call(A, 'POST', `/api/wg/${code}/invites`, {});
const tok = inv.body.url?.split('/').pop();
const jb = await call(B, 'POST', `/api/wg/${code}/members`, { name: 'Ben', inviteToken: tok });
expect(jb.status < 300, 'B tritt bei', JSON.stringify(jb.body));
const benId = jb.body.member?.id;

// ---- Shopping
const s1 = await call(A, 'POST', `/api/wg/${code}/shopping`, { name: 'Hafermilch', quantity: '2' });
expect(s1.status < 300, 'Einkauf: Artikel anlegen', JSON.stringify(s1.body));
const sItem = s1.body.item ?? s1.body;
const sList = await call(B, 'GET', `/api/wg/${code}/shopping`);
expect(
	JSON.stringify(sList.body).includes('Hafermilch'),
	'Einkauf: B sieht Artikel',
	JSON.stringify(sList.body).slice(0, 200),
);
const s2 = await call(B, 'PATCH', `/api/wg/${code}/shopping/${sItem.id}`, {
	bought: true,
	expectedUpdatedAt: sItem.updatedAt,
	expectedBoughtAt: null,
});
expect(s2.status < 300, 'Einkauf: abhaken', JSON.stringify(s2.body));
const s3 = await call(A, 'PATCH', `/api/wg/${code}/shopping/${sItem.id}`, {
	name: 'Sojamilch',
	expectedUpdatedAt: sItem.updatedAt,
	expectedBoughtAt: null,
});
expect(s3.status === 409, 'Einkauf: veralteter Stand = 409', JSON.stringify(s3));
const s4 = await call(A, 'DELETE', `/api/wg/${code}/shopping/${sItem.id}`);
expect(s4.status < 300, 'Einkauf: löschen', JSON.stringify(s4.body));
expect(
	+sql(`select count(*) from shopping_items where id='${sItem.id}'`) === 0,
	'Einkauf: in DB weg',
);

// ---- Inventory
const i1 = await call(A, 'POST', `/api/wg/${code}/inventory`, {
	name: 'Klopapier',
	quantity: 5,
	threshold: 2,
	category: 'putzmittel',
});
expect(i1.status < 300, 'Inventar: anlegen', JSON.stringify(i1.body));
const invItem = i1.body.item ?? i1.body;
const iDup = await call(B, 'POST', `/api/wg/${code}/inventory`, { name: 'klopapier' });
expect(iDup.status === 409, 'Inventar: Duplikat (case-insensitive) = 409', JSON.stringify(iDup));
const c1 = await call(B, 'POST', `/api/wg/${code}/inventory/${invItem.id}/consume`, { delta: -4 });
expect(c1.status < 300, 'Inventar: verbrauchen', JSON.stringify(c1.body));
expect(
	c1.body.item?.quantity === 1 && c1.body.autoPushedShoppingItemId,
	'Inventar: unter Schwelle → Einkaufsliste',
	JSON.stringify(c1.body),
);
const c2 = await call(B, 'POST', `/api/wg/${code}/inventory/${invItem.id}/consume`, { delta: -9 });
expect(
	c2.status < 300 && c2.body.item?.quantity === 0 && c2.body.clamped === true,
	'Inventar: nie negativ (clamped)',
	JSON.stringify(c2.body),
);
const i2 = await call(A, 'PATCH', `/api/wg/${code}/inventory/${invItem.id}`, {
	quantity: 10,
	expectedQuantity: 0,
	expectedUpdatedAt: c2.body.item?.updatedAt,
});
expect(i2.status < 300, 'Inventar: auffüllen', JSON.stringify(i2.body));
const i3 = await call(A, 'DELETE', `/api/wg/${code}/inventory/${invItem.id}`);
expect(i3.status < 300, 'Inventar: löschen', JSON.stringify(i3.body));

// ---- Events
const e1 = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Hausversammlung',
	startsAt: iso(2 * DAY),
	endsAt: iso(2 * DAY + 3_600_000),
	location: 'Küche',
	description: null,
});
expect(e1.status < 300, 'Kalender: Termin anlegen', JSON.stringify(e1.body));
const ev = e1.body.event ?? e1.body;
const eBad = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Falsch',
	startsAt: iso(2 * DAY),
	endsAt: iso(DAY),
});
expect(eBad.status === 400, 'Kalender: Ende vor Anfang = 400', JSON.stringify(eBad));
const e2x = await call(B, 'PATCH', `/api/wg/${code}/events/${ev.id}`, { title: 'Gehackt' });
expect(e2x.status === 403, 'Kalender: Fremder ändert nicht', JSON.stringify(e2x));
const e2 = await call(A, 'PATCH', `/api/wg/${code}/events/${ev.id}`, { title: 'WG-Versammlung' });
expect(e2.status < 300, 'Kalender: umbenennen', JSON.stringify(e2.body));
const er = await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Putztag',
	startsAt: iso(DAY),
	allDay: true,
	recurrence: 'FREQ=WEEKLY',
});
expect(er.status < 300, 'Kalender: Serie anlegen', JSON.stringify(er.body));
const serie = er.body.event ?? er.body;
const list = await call(B, 'GET', `/api/wg/${code}/events?from=${iso(0)}&to=${iso(30 * DAY)}`);
expect(list.status === 200, 'Kalender: Liste', JSON.stringify(list.body).slice(0, 200));
const occStart = serie.startsAt ?? iso(DAY);
const oc = await call(A, 'POST', `/api/wg/${code}/events/${serie.id}/occurrence`, {
	action: 'cancel',
	occurrenceStartsAt: occStart,
});
expect(oc.status < 300, 'Kalender: Einzeltermin der Serie absagen', JSON.stringify(oc.body));
const e3 = await call(A, 'DELETE', `/api/wg/${code}/events/${ev.id}`);
expect(e3.status < 300, 'Kalender: löschen', JSON.stringify(e3.body));

// ---- Calendar subscription
const cs = await call(A, 'POST', `/api/wg/${code}/calendar-subscription`, {});
expect(cs.status < 300, 'Kalender-Abo: anlegen', JSON.stringify(cs.body));
const feed = cs.body.subscription?.feedUrl ?? cs.body.feedUrl ?? '';
if (feed) {
	const ics = await fetch(feed.startsWith('http') ? feed : `${BASE}${feed}`);
	const text = await ics.text();
	expect(
		ics.status === 200 && text.includes('BEGIN:VCALENDAR'),
		'Kalender-Abo: ICS lädt',
		`${ics.status} ${text.slice(0, 120)}`,
	);
	expect(text.includes('Putztag'), 'Kalender-Abo: Serie im Feed', text.slice(0, 300));
} else {
	bugs.push(`Kalender-Abo: keine URL in Antwort :: ${JSON.stringify(cs.body).slice(0, 200)}`);
}
const csDel = await call(A, 'DELETE', `/api/wg/${code}/calendar-subscription`);
expect(csDel.status < 300, 'Kalender-Abo: löschen', JSON.stringify(csDel.body));
if (feed) {
	const gone = await fetch(feed.startsWith('http') ? feed : `${BASE}${feed}`);
	expect(gone.status >= 400, 'Kalender-Abo: Feed nach Löschen gesperrt', String(gone.status));
}

// ---- Expenses, settlement, manual payment
const ex = async (u, amt, payer, ids) =>
	call(u, 'POST', `/api/wg/${code}/expenses`, {
		amountCents: amt,
		description: 'Einkauf',
		category: 'lebensmittel',
		paidByMemberId: payer,
		splits: ids.map((id, i) => ({
			debtorMemberId: id,
			amountCents: Math.floor(amt / ids.length) + (i < amt % ids.length ? 1 : 0),
		})),
	});
const x1 = await ex(A, 6000, annaId, [annaId, benId]); // Ben owes Anna 30
const x2 = await ex(B, 2000, benId, [annaId, benId]); // Anna owes Ben 10 → net Ben owes Anna 20
expect(x1.status < 300 && x2.status < 300, 'Ausgaben anlegen', `${x1.status} ${x2.status}`);
const dash = await call(B, 'GET', `/api/wg/${code}/dashboard`);
expect(dash.status === 200, 'Dashboard', JSON.stringify(dash.body).slice(0, 200));
const bal = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
expect(
	bal.body.balances?.some((b) => b.amount_cents === 2000),
	'Saldo: Ben schuldet Anna 20 €',
	JSON.stringify(bal.body),
);
const settlement = await call(
	B,
	'GET',
	`/api/wg/${code}/expenses/settle-batch?fromMemberId=${benId}&toMemberId=${annaId}`,
);
expect(
	settlement.status === 200,
	'Abrechnung: Übersicht',
	JSON.stringify(settlement.body).slice(0, 300),
);
if (VERBOSE) process.stdout.write(`settlement ${JSON.stringify(settlement.body).slice(0, 1500)}\n`);
// Manual payment: wrong expected net must be refused, right one books it.
const pmBad = await call(B, 'POST', `/api/wg/${code}/payments/manual`, {
	fromMemberId: benId,
	toMemberId: annaId,
	expectedNetCents: 1500,
});
expect(pmBad.status === 409, 'Barzahlung: veralteter Saldo = 409', JSON.stringify(pmBad));
const pm = await call(B, 'POST', `/api/wg/${code}/payments/manual`, {
	fromMemberId: benId,
	toMemberId: annaId,
	expectedNetCents: 2000,
});
expect(pm.status < 300, 'Barzahlung: 20 € buchen', JSON.stringify(pm.body));
const bal2 = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
expect(
	(bal2.body.balances ?? []).every((b) => b.amount_cents === 0) ||
		(bal2.body.balances ?? []).length === 0,
	'Saldo nach Barzahlung: 0',
	JSON.stringify(bal2.body),
);
expect(
	+sql(
		`select count(*) from expense_payments where wg_id=(select id from wgs where share_code='${code}') and status='completed' and provider='manual' and amount_cents=2000`,
	) === 1,
	'Barzahlung in DB (completed, manual, 2000)',
);
const pmAgain = await call(B, 'POST', `/api/wg/${code}/payments/manual`, {
	fromMemberId: benId,
	toMemberId: annaId,
	expectedNetCents: 2000,
});
expect(pmAgain.status === 409, 'Barzahlung: doppelt = 409', JSON.stringify(pmAgain));
// Fresh debt and settle-batch with the reviewed snapshot
const x3 = await ex(A, 1000, annaId, [benId]); // Ben owes Anna 10
expect(x3.status < 300, 'Ausgabe 10 € nur für Ben', JSON.stringify(x3.body));
const st2 = await call(
	B,
	'GET',
	`/api/wg/${code}/expenses/settle-batch?fromMemberId=${benId}&toMemberId=${annaId}`,
);
const d2 =
	st2.body.netCents !== undefined ? st2.body : (st2.body.settlement ?? st2.body.debt ?? null);
expect(
	d2 && d2.netCents === 1000,
	'Abrechnung: offener Saldo 10 €',
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
	expect(sb.status < 300, 'Abrechnung: Ausgleich bestätigen', JSON.stringify(sb.body));
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
		'Abrechnung: zweiter Ausgleich abgelehnt',
		JSON.stringify(sbAgain),
	);
	const bal3 = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
	expect(
		(bal3.body.balances ?? []).every((b) => b.amount_cents === 0) ||
			(bal3.body.balances ?? []).length === 0,
		'Saldo nach Ausgleich: 0',
		JSON.stringify(bal3.body),
	);
}
const delSettled = await call(A, 'DELETE', `/api/wg/${code}/expenses/${x1.body.expense?.id}`);
expect(
	delSettled.status < 300,
	'Ausgabe nach Barzahlung löschbar (Zahlung bleibt als Guthaben)',
	JSON.stringify(delSettled.body),
);
const delSettledSplit = await call(A, 'DELETE', `/api/wg/${code}/expenses/${x3.body.expense?.id}`);
expect(
	delSettledSplit.status === 409,
	'Ausgabe mit beglichenem Anteil nicht löschbar',
	JSON.stringify(delSettledSplit),
);
const xe = await call(B, 'PATCH', `/api/wg/${code}/expenses/${x2.body.expense?.id}`, {
	description: 'Getränke',
});
expect(xe.status < 300 || xe.status === 409, 'Ausgabe bearbeiten', JSON.stringify(xe.body));
const xStranger = await call(B, 'PATCH', `/api/wg/${code}/expenses/${x1.body.expense?.id}`, {
	description: 'fremd',
});
expect(xStranger.status >= 400, 'fremde Ausgabe nicht bearbeitbar', JSON.stringify(xStranger));

// ---- Recurring + cron
const rc = await call(A, 'POST', `/api/wg/${code}/recurring-expenses`, {
	description: 'Internet',
	category: 'wohnen',
	amountCents: 4000,
	paidByMemberId: annaId,
	intervalMonths: 1,
	nextDueAt: iso(-DAY),
	splits: [
		{ debtorMemberId: annaId, amountCents: 2000 },
		{ debtorMemberId: benId, amountCents: 2000 },
	],
});
expect(rc.status < 300, 'Fixkosten: Vorlage anlegen', JSON.stringify(rc.body));
const rec = rc.body.recurringExpense ?? rc.body;
const cronNoAuth = await fetch(`${BASE}/api/cron/recurring-advance`);
expect(cronNoAuth.status === 401, 'Cron ohne Secret = 401', String(cronNoAuth.status));
const cron = await fetch(`${BASE}/api/cron/recurring-advance`, {
	headers: { authorization: `Bearer ${CRON}` },
});
expect(
	cron.status === 200,
	'Cron Fixkosten läuft',
	`${cron.status} ${(await cron.text()).slice(0, 200)}`,
);
expect(
	+sql(
		`select count(*) from expenses where description='Internet' and wg_id=(select id from wgs where share_code='${code}')`,
	) === 1,
	'Fixkosten: Cron hat genau eine Ausgabe gebucht',
);
const cron2 = await fetch(`${BASE}/api/cron/recurring-advance`, {
	headers: { authorization: `Bearer ${CRON}` },
});
expect(cron2.status === 200, 'Cron zweiter Lauf ok');
expect(
	+sql(
		`select count(*) from expenses where description='Internet' and wg_id=(select id from wgs where share_code='${code}')`,
	) === 1,
	'Fixkosten: zweiter Cron-Lauf bucht nicht doppelt',
);
const recNow = await call(A, 'GET', `/api/wg/${code}/recurring-expenses`);
const recRow =
	(recNow.body.recurringExpenses ?? recNow.body.items ?? []).find((r) => r.id === rec.id) ?? rec;
const rp = await call(A, 'PATCH', `/api/wg/${code}/recurring-expenses/${rec.id}`, {
	paused: true,
	expectedNextDueAt: recRow.nextDueAt,
});
expect(rp.status < 300, 'Fixkosten: pausieren', JSON.stringify(rp.body));
const rpB = await call(B, 'PATCH', `/api/wg/${code}/recurring-expenses/${rec.id}`, {
	amountCents: 1,
	expectedNextDueAt: recRow.nextDueAt,
});
expect(
	rpB.status === 403 || rpB.status === 400,
	'Fixkosten: Fremder darf nicht ändern',
	JSON.stringify(rpB),
);
const rd = await call(A, 'DELETE', `/api/wg/${code}/recurring-expenses/${rec.id}`);
expect(rd.status < 300, 'Fixkosten: löschen', JSON.stringify(rd.body));

// ---- Other crons
for (const name of ['maintenance', 'chore-reminders', 'event-reminders', 'monthly-statements']) {
	const r = await fetch(`${BASE}/api/cron/${name}`, {
		headers: { authorization: `Bearer ${CRON}` },
	});
	const t = await r.text();
	expect(r.status === 200, `Cron ${name}`, `${r.status} ${t.slice(0, 200)}`);
}

// ---- Pinnwand
const an = await call(A, 'POST', `/api/wg/${code}/announcements`, {
	content: 'Bitte Flaschen wegbringen',
	kind: 'request',
});
expect(an.status < 300, 'Pinnwand: Beitrag', JSON.stringify(an.body));
const post = an.body.announcement ?? an.body;
const cm = await call(B, 'POST', `/api/wg/${code}/announcements/${post.id}/comments`, {
	content: 'Mach ich',
});
expect(cm.status < 300, 'Pinnwand: Kommentar', JSON.stringify(cm.body));
const rx = await call(B, 'POST', `/api/wg/${code}/announcements/${post.id}/reactions`, {
	reaction: 'ok',
});
expect(rx.status < 300, 'Pinnwand: Reaktion', JSON.stringify(rx.body));
const anList = await call(B, 'GET', `/api/wg/${code}/announcements`);
expect(JSON.stringify(anList.body).includes('Flaschen'), 'Pinnwand: Liste zeigt Beitrag');
const resB = await call(B, 'PATCH', `/api/wg/${code}/announcements/${post.id}`, {
	status: 'resolved',
});
expect(resB.status === 403, 'Pinnwand: Fremder schließt nicht', JSON.stringify(resB));
const res = await call(A, 'PATCH', `/api/wg/${code}/announcements/${post.id}`, {
	status: 'resolved',
});
expect(res.status < 300, 'Pinnwand: Autor schließt', JSON.stringify(res.body));
const anEmpty = await call(A, 'PATCH', `/api/wg/${code}/announcements/${post.id}`, {});
expect(anEmpty.status === 400, 'Pinnwand: leerer Patch = 400', JSON.stringify(anEmpty));
const anDel = await call(B, 'DELETE', `/api/wg/${code}/announcements/${post.id}`);
expect(anDel.status >= 400, 'Pinnwand: Fremder löscht nicht', JSON.stringify(anDel));
const anDelOwn = await call(A, 'DELETE', `/api/wg/${code}/announcements/${post.id}`);
expect(anDelOwn.status < 300, 'Pinnwand: Autor löscht', JSON.stringify(anDelOwn.body));

// ---- Absences + chores
const ab = await call(B, 'POST', `/api/wg/${code}/absences`, {
	memberId: benId,
	startDate: iso(DAY),
	endDate: iso(3 * DAY),
	reason: 'Heimfahrt',
});
expect(ab.status < 300, 'Abwesenheit: anlegen', JSON.stringify(ab.body));
const abId = (ab.body.absence ?? ab.body).id;
const abOther = await call(B, 'POST', `/api/wg/${code}/absences`, {
	memberId: annaId,
	startDate: iso(DAY),
	endDate: iso(2 * DAY),
});
expect(abOther.status >= 400, 'Abwesenheit: nicht für andere', JSON.stringify(abOther));
const ch = await call(A, 'POST', `/api/wg/${code}/chores`, {
	title: 'Küche',
	intervalDays: 1,
	assignedMemberId: benId,
});
expect(ch.status < 300, 'Putzplan: Aufgabe für Ben', JSON.stringify(ch.body));
const chores = await call(A, 'GET', `/api/wg/${code}/chores`);
expect(chores.status === 200, 'Putzplan: Liste', JSON.stringify(chores.body).slice(0, 200));
const abDel = await call(B, 'DELETE', `/api/wg/${code}/absences/${abId}`);
expect(abDel.status < 300, 'Abwesenheit: löschen', JSON.stringify(abDel.body));

// ---- Members: rename, admin handover, move out and back
const rn = await call(B, 'PATCH', `/api/wg/${code}/members/${benId}`, {
	name: 'Benjamin',
	expectedName: 'Ben',
});
expect(rn.status < 300, 'Mitglied: umbenennen', JSON.stringify(rn.body));
const rnStale = await call(B, 'PATCH', `/api/wg/${code}/members/${benId}`, {
	name: 'Benny',
	expectedName: 'Ben',
});
expect(rnStale.status === 409, 'Mitglied: veralteter Name = 409', JSON.stringify(rnStale));
const rnOther = await call(B, 'PATCH', `/api/wg/${code}/members/${annaId}`, { name: 'X' });
expect(rnOther.status === 403, 'Mitglied: Fremder benennt nicht um', JSON.stringify(rnOther));
const adminB = await call(B, 'POST', `/api/wg/${code}/members/${benId}/admin`, {});
expect(adminB.status === 400, 'Admin: Selbstübergabe = 400', JSON.stringify(adminB));
const adminB2 = await call(B, 'POST', `/api/wg/${code}/members/${annaId}/admin`, {});
expect(adminB2.status === 403, 'Admin: nur Admin vergibt', JSON.stringify(adminB2));
const wgRenameB = await call(B, 'PATCH', `/api/wg/${code}`, { name: 'Gehackt' });
expect(wgRenameB.status === 403, 'WG: Nicht-Admin benennt nicht um', JSON.stringify(wgRenameB));
const wgRename = await call(A, 'PATCH', `/api/wg/${code}`, { name: 'Modulwohnung 2' });
expect(wgRename.status < 300, 'WG: Admin benennt um', JSON.stringify(wgRename.body));
const out = await call(A, 'PATCH', `/api/wg/${code}/members/${benId}`, { active: false });
expect(out.status < 300, 'Mitglied: Auszug', JSON.stringify(out.body));
const outRead = await call(B, 'GET', `/api/wg/${code}/dashboard`);
expect(outRead.status === 401, 'Ausgezogener hat keinen Zugriff', JSON.stringify(outRead));
const back = await call(A, 'PATCH', `/api/wg/${code}/members/${benId}`, { active: true });
expect(back.status < 300, 'Mitglied: Rückkehr', JSON.stringify(back.body));
expect(
	(await call(B, 'GET', `/api/wg/${code}/dashboard`)).status === 200,
	'Rückkehrer hat Zugriff',
);
const handover = await call(A, 'POST', `/api/wg/${code}/members/${benId}/admin`, {});
expect(handover.status < 300, 'Admin: Übergabe an Ben', JSON.stringify(handover.body));
expect(
	sql(`select role from wg_members where id='${benId}'`) === 'admin' &&
		sql(`select role from wg_members where id='${annaId}'`) === 'member',
	'Admin: genau ein Admin in DB',
);

// ---- Notifications, activity, export, mine
const nf = await call(A, 'GET', `/api/wg/${code}/notifications`);
expect(nf.status === 200, 'Benachrichtigungen: lesen', JSON.stringify(nf.body).slice(0, 200));
const nfp = await call(A, 'PATCH', `/api/wg/${code}/notifications`, { notifyChat: false });
expect(nfp.status < 300, 'Benachrichtigungen: ändern', JSON.stringify(nfp.body));
const act = await call(A, 'GET', `/api/wg/${code}/activity`);
expect(act.status === 200, 'Aktivität', JSON.stringify(act.body).slice(0, 200));
const exp = await call(A, 'GET', `/api/wg/${code}/export`);
expect(exp.status === 200, 'Export', JSON.stringify(exp.body).slice(0, 200));
const mine = await call(A, 'GET', '/api/wg/mine');
expect(
	mine.status === 200 && JSON.stringify(mine.body).includes(code),
	'Meine WGs',
	JSON.stringify(mine.body).slice(0, 200),
);

// ---- Delete WG (admin is Ben now), delete account
const delA = await call(A, 'DELETE', `/api/wg/${code}`);
expect(delA.status === 403, 'WG löschen: Nicht-Admin = 403', JSON.stringify(delA));
const delB = await call(B, 'DELETE', `/api/wg/${code}`);
expect(delB.status < 300, 'WG löschen: Admin', JSON.stringify(delB.body));
expect(+sql(`select count(*) from wgs where share_code='${code}'`) === 0, 'WG in DB weg');
expect(
	+sql('select count(*) from expenses where wg_id is null') === 0,
	'keine verwaisten Ausgaben',
);
const w2 = await call(A, 'POST', '/api/wg', { name: 'Zweite', creatorName: 'Anna' });
const code2 = w2.body.wg?.shareCode;
const inv2 = await call(A, 'POST', `/api/wg/${code2}/invites`, {});
await call(B, 'POST', `/api/wg/${code2}/members`, {
	name: 'Ben',
	inviteToken: inv2.body.url?.split('/').pop(),
});
const accDel = await call(A, 'DELETE', '/api/account', {});
expect(accDel.status < 300, 'Konto löschen (Admin mit Nachfolger)', JSON.stringify(accDel.body));
expect(
	sql(
		`select role from wg_members where wg_id=(select id from wgs where share_code='${code2}') and auth_user_id='${B.id}'`,
	) === 'admin',
	'Konto löschen: Ben wird Admin',
);
expect(
	+sql(`select count(*) from auth.users where id='${A.id}'`) === 0,
	'Konto löschen: Auth-User weg',
);
const afterDel = await call(A, 'GET', '/api/wg/mine');
expect(afterDel.status === 401, 'Konto löschen: Sitzung ungültig', JSON.stringify(afterDel));

process.stdout.write(`oks=${oks.length} bugs=${bugs.length}\n`);
for (const entry of bugs) process.stdout.write(`- ${entry}\n`);

// Adversarial API checks, part 3: parallel writes (DB state checked afterwards), query parameters
// reaching the database, CSRF from a foreign origin. Prints the summary of all parts.
import { randomUUID } from 'node:crypto';
import {
	A,
	annaId,
	B,
	benId,
	choreId,
	code,
	exp,
	expenseId,
	inventoryId,
	messageId,
	splitId,
} from './fuzz-lib.mjs';
import { call, expect, finish, iso, sql, user } from './modules-lib.mjs';

// ---- 4. concurrency
const key = randomUUID();
const par = await Promise.all(
	Array.from({ length: 8 }, () =>
		call(A, 'POST', `/api/wg/${code}/expenses`, exp(1200, annaId, [annaId, benId]), {
			'idempotency-key': key,
		}),
	),
);
expect(
	par.every((r) => r.status < 300 || r.status === 409),
	'Parallel: gleiche Idempotenz = kein Fehler',
	`${par.map((r) => r.status).join(',')} ${JSON.stringify(par[0].body).slice(0, 120)}`,
);
expect(
	+sql(
		`select count(*) from expenses where wg_id=(select id from wgs where share_code='${code}') and amount_cents=1200`,
	) === 1,
	'Parallel: gleiche Idempotenz = genau eine Ausgabe',
);

const cons = await Promise.all(
	Array.from({ length: 8 }, () =>
		call(B, 'POST', `/api/wg/${code}/inventory/${inventoryId}/consume`, { delta: -1 }),
	),
);
const qty = +sql(`select quantity from wg_inventory_items where id='${inventoryId}'`);
expect(
	qty >= 0,
	'Parallel: Vorrat nie negativ',
	`qty=${qty} status=${cons.map((r) => r.status).join(',')}`,
);

const comp = await Promise.all(
	Array.from({ length: 6 }, () =>
		call(A, 'POST', `/api/wg/${code}/chores/${choreId}/complete`, { completedAt: iso(0) }),
	),
);
const compCount = +sql(`select count(*) from chore_completions where chore_id='${choreId}'`);
expect(
	compCount <= 1,
	'Parallel: Aufgabe nur einmal erledigt',
	`rows=${compCount} status=${comp.map((r) => r.status).join(',')}`,
);

const settle = await Promise.all(
	Array.from({ length: 6 }, () =>
		call(B, 'POST', `/api/wg/${code}/expenses/${expenseId}/splits/${splitId}/settle`, {}),
	),
);
expect(
	settle.every((r) => r.status < 500),
	'Parallel: Split-Settle ohne 5xx',
	settle.map((r) => r.status).join(','),
);

const balBefore = await call(A, 'GET', `/api/wg/${code}/reminders/balances`);
const net = (balBefore.body.balances ?? []).find((d) => d.debtor_id === benId)?.amount_cents ?? 0;
const pay = await Promise.all(
	Array.from({ length: 6 }, () =>
		call(B, 'POST', `/api/wg/${code}/payments/manual`, {
			fromMemberId: benId,
			toMemberId: annaId,
			expectedNetCents: net,
		}),
	),
);
const payCount = +sql(
	`select count(*) from expense_payments where wg_id=(select id from wgs where share_code='${code}') and status='completed'`,
);
expect(
	payCount <= 1,
	'Parallel: Barzahlung nur einmal gebucht',
	`rows=${payCount} status=${pay.map((r) => r.status).join(',')} net=${String(JSON.stringify(net)).slice(0, 120)}`,
);

const inv = await call(A, 'POST', `/api/wg/${code}/invites`, {});
const tok = inv.body.url?.split('/').pop();
const joiners = await Promise.all(['Dana', 'Emil', 'Finn', 'Gina'].map((n) => user(n)));
const joins = await Promise.all(
	joiners.map((u) =>
		call(u, 'POST', `/api/wg/${code}/members`, { name: 'Gleich', inviteToken: tok }),
	),
);
const sameName = +sql(
	`select count(*) from wg_members where wg_id=(select id from wgs where share_code='${code}') and name='Gleich'`,
);
expect(
	sameName <= 1 && joins.every((r) => r.status < 500),
	'Parallel: gleicher Name beitreten = ein Mitglied, keine 5xx',
	`rows=${sameName} status=${joins.map((r) => r.status).join(',')}`,
);

const adminRace = await Promise.all([
	call(A, 'POST', `/api/wg/${code}/members/${benId}/admin`, {}),
	call(A, 'POST', `/api/wg/${code}/members/${benId}/admin`, {}),
]);
const admins = +sql(
	`select count(*) from wg_members where wg_id=(select id from wgs where share_code='${code}') and role='admin'`,
);
expect(
	admins === 1 && adminRace.every((r) => r.status < 500),
	'Parallel: genau ein Admin',
	`admins=${admins} status=${adminRace.map((r) => r.status).join(',')}`,
);

const sumsOk = sql(
	`select count(*) from expenses e where e.wg_id=(select id from wgs where share_code='${code}') and amount_cents<>(select coalesce(sum(amount_cents),0) from expense_splits s where s.expense_id=e.id)`,
);
expect(+sumsOk === 0, 'DB: Splits summieren zur Ausgabe');

// ---- 5. query and path parameters that reach the database
const qFails = [];
let qCalls = 0;
const qValues = [
	'%00',
	'abc',
	encodeURIComponent('x'.repeat(3000)),
	randomUUID(),
	'-1',
	'1e9',
	encodeURIComponent('🙂'),
	'..%2F..',
];
for (const v of qValues) {
	for (const [m, p] of [
		['GET', `/api/wg/${code}/chat/messages?before=${v}&beforeId=${v}&limit=${v}`],
		['DELETE', `/api/wg/${code}/chat/messages/${messageId}/reactions?emoji=${v}`],
		[
			'GET',
			`/api/wg/${code}/expenses/settle-batch?fromMemberId=${v}&toMemberId=${v}&currency=${v}`,
		],
		['GET', `/api/wg/${code}/activity?limit=${v}`],
		['GET', `/api/wg/${code}/inventory?lowStock=${v}`],
		['POST', `/api/wg/${code}/members/${benId}/claim?invite=${v}`],
		['GET', `/api/wg/${code}/export?format=${v}&sections=${v}&section=${v}&summary=${v}`],
		['GET', `/api/wg/${code}/events?from=${v}&to=${v}`],
		['GET', `/api/email/unsubscribe?t=${v}`],
		['POST', `/api/email/unsubscribe?t=${v}`],
		['GET', `/api/upload/read?key=${v}`],
		['GET', `/api/wg/invites/${v}`],
		['GET', `/api/calendar/${v}/${v}`],
		['GET', `/api/wg/${v}`],
		['GET', `/api/wg/${v}/dashboard`],
		['POST', `/api/wg/${v}/expenses`],
	]) {
		qCalls++;
		const r = await call(A, m, p, m === 'GET' ? undefined : {});
		if (r.status >= 500)
			qFails.push(`${m} ${p.slice(0, 90)} -> ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
	}
}
expect(qFails.length === 0, `Query-Parameter: keine 5xx (${qCalls} Aufrufe)`, qFails.join(' | '));

// ---- 6. CSRF: cookie-authenticated writes from a foreign origin
const evil = await A.ctx.fetch(`/api/wg/${code}/shopping`, {
	method: 'POST',
	data: { name: 'Fremd', quantity: '1' },
	headers: {
		'content-type': 'application/json',
		origin: 'https://evil.example',
		'idempotency-key': randomUUID(),
	},
});
expect(evil.status() >= 400, 'CSRF: fremde Origin wird abgewiesen', String(evil.status()));
const evilDelete = await A.ctx.fetch(`/api/wg/${code}`, {
	method: 'DELETE',
	headers: { origin: 'https://evil.example' },
});
expect(
	evilDelete.status() >= 400,
	'CSRF: WG-Löschung von fremder Origin abgewiesen',
	String(evilDelete.status()),
);
expect(
	+sql(`select count(*) from wgs where share_code='${code}'`) === 1,
	'CSRF: WG existiert noch',
);

finish();

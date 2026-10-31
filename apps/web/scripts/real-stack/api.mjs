import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';
import { BASE, DB, SB } from './env.mjs';

// Service key of the local `supabase start` stack: `supabase status -o env` prints it.
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (see supabase status -o env)');
const sql = (q) =>
	// No shell: the query reaches psql as one argument, whatever quotes it contains.
	execFileSync('psql', [DB, '-Atc', q]).toString().trim();
const stamp = Date.now();
const bugs = [];
const oks = [];
const ok = (m) => {
	oks.push(m);
};
const bug = (m) => {
	bugs.push(m);
};
const expect = (c, m, extra = '') =>
	c ? ok(m) : bug(m + (extra ? ` :: ${String(extra).slice(0, 220)}` : ''));
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
		headers: { 'content-type': 'application/json', ...headers },
	});
	return { status: res.status(), body: await j(res) };
};
const A = await user('Anna');
const B = await user('Ben');
const C = await user('Cleo');
const D = await user('Dora');
const E = await user('Emil');

// S1 create WG + idempotency replay
const key = randomUUID();
const w1 = await call(
	A,
	'POST',
	'/api/wg',
	{ name: 'Testwohnung', creatorName: 'Anna' },
	{ 'idempotency-key': key },
);
expect(w1.status === 200 || w1.status === 201, 'S1 create WG', JSON.stringify(w1));
const code = w1.body.wg?.shareCode;
const annaMember = w1.body.creator?.id;
const w1b = await call(
	A,
	'POST',
	'/api/wg',
	{ name: 'Testwohnung', creatorName: 'Anna' },
	{ 'idempotency-key': key },
);
expect(
	w1b.body.wg?.shareCode === code,
	'S1 idempotency: same key = same WG',
	JSON.stringify(w1b).slice(0, 200),
);
expect(
	+sql(
		`select count(*) from wgs where name='Testwohnung' and id in (select wg_id from wg_members where auth_user_id='${A.id}')`,
	) === 1,
	'S1 exactly one WG in DB',
);
// S2 invites + join
const inv = await call(A, 'POST', `/api/wg/${code}/invites`, {});
expect(inv.status < 300 && inv.body.url, 'S2 create invite', JSON.stringify(inv));
const tok = inv.body.url?.split('/').pop();
expect((await call(C, 'GET', `/api/wg/${code}`)).status >= 400, 'S6 non-member C cannot see WG');
expect(
	(await call(C, 'POST', `/api/wg/${code}/members`, { name: 'Cleo' })).status === 403,
	'S2 join without invite = 403',
);
const jb = await call(
	B,
	'POST',
	`/api/wg/${code}/members`,
	{ name: 'Ben', inviteToken: tok },
	{ 'idempotency-key': randomUUID() },
);
expect(jb.status === 200 || jb.status === 201, 'S2 B joins', JSON.stringify(jb));
const benMember = jb.body.member?.id;
const jb2 = await call(
	B,
	'POST',
	`/api/wg/${code}/members`,
	{ name: 'Ben2', inviteToken: tok },
	{ 'idempotency-key': randomUUID() },
);
expect(jb2.status === 409, 'S2 duplicate join = 409', JSON.stringify(jb2));
const nameDup = await call(
	C,
	'POST',
	`/api/wg/${code}/members`,
	{ name: 'ANNA', inviteToken: tok },
	{ 'idempotency-key': randomUUID() },
);
expect(nameDup.status === 409, 'S2 same name (case-insensitive) = 409', JSON.stringify(nameDup));
// S10 concurrent join at max_uses
const inv2 = await call(A, 'POST', `/api/wg/${code}/invites`, {});
const tok2 = inv2.body.url.split('/').pop();
sql(`update wg_invites set max_uses=1 where token='${tok2}'`);
const racers = [C, D, E];
const rs = await Promise.all(
	racers.map((u, i) =>
		call(
			u,
			'POST',
			`/api/wg/${code}/members`,
			{ name: `R${i}`, inviteToken: tok2 },
			{ 'idempotency-key': randomUUID() },
		),
	),
);
expect(
	rs.filter((r) => r.status < 300).length === 1,
	'S10 parallel join with max_uses=1: exactly one',
	JSON.stringify(rs.map((r) => r.status)),
);
expect(+sql(`select use_count from wg_invites where token='${tok2}'`) === 1, 'S10 use_count = 1');
const joined = racers.filter((_u, i) => rs[i].status < 300);
const notJoined = racers.filter((_u, i) => rs[i].status >= 300);
// revoke
const inv3 = await call(A, 'POST', `/api/wg/${code}/invites`, {});
const del = await call(A, 'DELETE', `/api/wg/${code}/invites/${inv3.body.id}`);
expect(del.status < 300, 'S2 revoke invite', JSON.stringify(del));
const rv = await call(
	notJoined[0],
	'POST',
	`/api/wg/${code}/members`,
	{ name: 'Zed', inviteToken: inv3.body.url.split('/').pop() },
	{ 'idempotency-key': randomUUID() },
);
expect(rv.status === 410 || rv.status === 403, 'S2 revoked invite rejected', JSON.stringify(rv));
// S3 Expenses
const members = (await call(A, 'GET', `/api/wg/${code}`)).body;
const _mem = members.members ?? members.wg?.members ?? [];
const ex = async (u, amt, ids, extra = {}) =>
	call(
		u,
		'POST',
		`/api/wg/${code}/expenses`,
		{
			amountCents: amt,
			description: 'Test',
			category: 'groceries',
			splits: ids.map((id, i) => ({
				debtorMemberId: id,
				amountCents: Math.floor(amt / ids.length) + (i < amt % ids.length ? 1 : 0),
			})),
			...extra,
		},
		{ 'idempotency-key': randomUUID() },
	);
const e1 = await ex(A, 10000, [annaMember, benMember]);
expect(e1.status < 300, 'S3 create 100 € expense', JSON.stringify(e1));
const e2 = await ex(B, 1000, [
	annaMember,
	benMember,
	joined[0] ? sql(`select id from wg_members where auth_user_id='${joined[0].id}'`) : benMember,
]);
expect(
	e2.status < 300,
	'S3 10 € expense split across 3 people (3.34/3.33/3.33)',
	JSON.stringify(e2),
);
const bad = await call(
	A,
	'POST',
	`/api/wg/${code}/expenses`,
	{
		amountCents: 1000,
		description: 'x',
		category: 'groceries',
		splits: [{ debtorMemberId: annaMember, amountCents: 999 }],
	},
	{ 'idempotency-key': randomUUID() },
);
expect(bad.status === 400, 'S3 wrong sum = 400', JSON.stringify(bad));
const neg = await call(
	A,
	'POST',
	`/api/wg/${code}/expenses`,
	{
		amountCents: -500,
		description: 'x',
		category: 'groceries',
		splits: [{ debtorMemberId: annaMember, amountCents: -500 }],
	},
	{ 'idempotency-key': randomUUID() },
);
expect(neg.status === 400, 'S3 negative amount = 400', JSON.stringify(neg));
const foreignPayer = await call(
	A,
	'POST',
	`/api/wg/${code}/expenses`,
	{
		amountCents: 1000,
		description: 'x',
		category: 'groceries',
		paidByMemberId: randomUUID(),
		splits: [{ debtorMemberId: annaMember, amountCents: 1000 }],
	},
	{ 'idempotency-key': randomUUID() },
);
expect(foreignPayer.status >= 400, 'S3 foreign payer rejected', JSON.stringify(foreignPayer));
const dash = await call(A, 'GET', `/api/wg/${code}/dashboard`);
expect(dash.status === 200, 'S3 dashboard loads', JSON.stringify(dash).slice(0, 150));
const sum = sql(
	`select (select coalesce(sum(es.amount_cents),0) from expense_splits es join expenses e on e.id=es.expense_id where e.wg_id=w.id)-(select coalesce(sum(amount_cents),0) from expenses where wg_id=w.id) from wgs w where share_code='${code}'`,
);
expect(+sum === 0, 'S3 sum of all splits = sum of all expenses (DB)', sum);
// Delete a foreign expense as a non-member
const eid = e1.body.expense?.id;
expect(
	(await call(notJoined[0], 'DELETE', `/api/wg/${code}/expenses/${eid}`)).status >= 400,
	'S6 non-member cannot delete expense',
);
// Cross-WG: B creates an own WG and tries to touch A's expense via its own WG address
const wB = await call(
	B,
	'POST',
	'/api/wg',
	{ name: 'Ben WG', creatorName: 'Ben' },
	{ 'idempotency-key': randomUUID() },
);
const codeB = wB.body.wg?.shareCode;
expect(
	(await call(B, 'PATCH', `/api/wg/${codeB}/expenses/${eid}`, { description: 'gehackt' })).status >=
		400 && sql(`select description from expenses where id='${eid}'`) === 'Test',
	'S6 cross-WG: expense ID from another WG cannot be changed',
);
expect(
	(await call(B, 'DELETE', `/api/wg/${codeB}/expenses/${eid}`)).status >= 400 &&
		+sql(`select count(*) from expenses where id='${eid}'`) === 1,
	'S6 cross-WG: expense cannot be deleted',
);
// S4 Chore plan
const ch = await call(
	A,
	'POST',
	`/api/wg/${code}/chores`,
	{ title: 'Bad', intervalDays: 7, assignedMemberId: annaMember },
	{ 'idempotency-key': randomUUID() },
);
expect(ch.status < 300, 'S4 create chore', JSON.stringify(ch));
const cid = ch.body.chore?.id;
const occ = () => ({
	expectedNextDueAt: new Date(
		sql(`select extract(epoch from next_due_at)*1000 from chores where id='${cid}'`) * 1,
	).toISOString(),
	expectedAssignedMemberId: sql(`select assigned_member_id from chores where id='${cid}'`) || null,
});
const done = await call(A, 'POST', `/api/wg/${code}/chores/${cid}/complete`, occ(), {
	'idempotency-key': randomUUID(),
});
expect(done.status < 300, 'S4 completed', JSON.stringify(done));
const _notMine = await call(B, 'POST', `/api/wg/${code}/chores/${cid}/complete`, occ(), {
	'idempotency-key': randomUUID(),
});
const o4 = occ();
const _parChores = await Promise.all(
	[1, 2, 3, 4].map(() =>
		call(A, 'POST', `/api/wg/${code}/chores/${cid}/complete`, o4, {
			'idempotency-key': randomUUID(),
		}),
	),
);
// S5 Chat
const m1 = await call(
	A,
	'POST',
	`/api/wg/${code}/chat/messages`,
	{ body: 'Hallo <b>Welt</b> & "Quotes"' },
	{ 'idempotency-key': randomUUID() },
);
expect(m1.status < 300, 'S5 send chat message', JSON.stringify(m1));
expect(
	(await call(B, 'GET', `/api/wg/${code}/chat/unread-count`)).body.count >= 1,
	'S5 B has unread',
);
expect(
	(await call(C === notJoined[0] ? C : notJoined[0], 'GET', `/api/wg/${code}/chat/messages`))
		.status >= 400,
	'S6 non-member cannot read chat',
);
const empty = await call(
	A,
	'POST',
	`/api/wg/${code}/chat/messages`,
	{ body: '   ' },
	{ 'idempotency-key': randomUUID() },
);
expect(empty.status === 400, 'S5 empty message = 400', JSON.stringify(empty));
// S8 delete account
const _delA = await call(B, 'DELETE', '/api/account', {});
const _stillB = await call(B, 'GET', '/api/wg/mine');
process.stdout.write(`oks=${oks.length} bugs=${bugs.length}\n`);
for (const entry of bugs) process.stdout.write(`- ${entry}\n`);
if (bugs.length > 0) process.exitCode = 1;

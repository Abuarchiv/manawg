import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';

// Module-level API checks against the local real stack (see README): shopping, inventory, events,
// payments and settlement, recurring expenses with the cron, pinnwand, absences, members, calendar
// subscription, export, crons, WG rename and deletion, account deletion.
export const BASE = 'http://localhost:3140';
export const SB = 'http://127.0.0.1:54321';
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const CRON = process.env.CRON_SECRET ?? '';
if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (see supabase status -o env)');
if (!CRON) throw new Error('CRON_SECRET missing (same value the server runs with)');
export const VERBOSE = process.env.VERBOSE === '1';
export const sql = (q) =>
	// No shell: the query reaches psql as one argument, whatever quotes it contains.
	execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-Atc', q])
		.toString()
		.trim();
export const stamp = Date.now();
export const bugs = [];
export const oks = [];
export const expect = (c, m, extra = '') => {
	if (c) oks.push(m);
	else bugs.push(m + (extra ? ` :: ${String(extra).slice(0, 300)}` : ''));
};
export const show = (label, r) => {
	if (VERBOSE)
		process.stdout.write(`${label} ${r.status} ${JSON.stringify(r.body).slice(0, 400)}\n`);
};
export async function user(name) {
	const email = `${name.toLowerCase()}${stamp}${randomUUID().slice(0, 4)}@example.test`;
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
export const call = async (u, method, path, data, headers = {}) => {
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
export const iso = (offsetMs) => new Date(stamp + offsetMs).toISOString();
export const DAY = 86_400_000;

/** Two confirmed accounts, Anna creates the WG, Ben joins through an invite. */
export async function setup() {
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
	return { A, B, code, annaId, benId };
}

export function finish() {
	process.stdout.write(`oks=${oks.length} bugs=${bugs.length}\n`);
	for (const entry of bugs) process.stdout.write(`- ${entry}\n`);
}

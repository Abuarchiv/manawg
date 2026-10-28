// E-mail-code login (code read from Mailpit), invitation by mail (ledger), receipt upload through
// Supabase Storage with access checks and revocation after the expense is deleted.
import { randomUUID } from 'node:crypto';
import { chromium, devices, request } from '@playwright/test';
import { BASE, call, expect, finish, SB, SERVICE, setup, sql, user } from './modules-lib.mjs';

const MAIL = 'http://127.0.0.1:54324/api/v1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mailFor = async (email, tries = 20) => {
	for (let i = 0; i < tries; i += 1) {
		const s = await (
			await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${email}`)}`)
		).json();
		if (s.messages?.length) return (await fetch(`${MAIL}/message/${s.messages[0].ID}`)).json();
		await wait(500);
	}
	return null;
};

// 1 E-mail code login in the browser
const email = `code${Date.now()}@example.test`;
await fetch(`${SB}/auth/v1/admin/users`, {
	method: 'POST',
	headers: {
		apikey: SERVICE,
		authorization: `Bearer ${SERVICE}`,
		'content-type': 'application/json',
	},
	body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: 'Codi' } }),
});
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
const p = await ctx.newPage();
const bad = [];
p.on('response', (r) => {
	if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`);
});
await p.goto('/neu');
await p.waitForLoadState('networkidle');
await p.locator('#auth-code-email').fill(email);
await p.getByRole('button', { name: 'Code per E-Mail senden' }).click();
await p.locator('#auth-code').waitFor({ timeout: 15_000 });
const m = await mailFor(email);
const code = m?.Text?.match(/\b(\d{8})\b/)?.[1] ?? m?.HTML?.match(/\b(\d{8})\b/)?.[1];
expect(!!code, 'Code-Mail mit 8 Ziffern angekommen', m?.Subject ?? 'keine Mail');
await p.locator('#auth-code').fill('00000000');
await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
await wait(1500);
const wrong = await p.locator('main').innerText();
expect(
	/ungültig|falsch|abgelaufen|nicht/i.test(wrong),
	'falscher Code zeigt Fehlertext',
	wrong.slice(0, 80),
);
await p.locator('#auth-code').fill(code ?? '');
await p.getByRole('button', { name: 'Anmelden', exact: true }).click();
await p
	.getByText(/WG erstellen|Neue WG|Deine WGs/i)
	.first()
	.waitFor({ timeout: 15_000 });
const signedIn = (await ctx.cookies()).some(
	(c) => c.name === 'manawg_signed_in' && c.value === '1',
);
expect(signedIn, 'nach Code-Login angemeldet (Hinweis-Cookie)');
expect(bad.length === 0, 'keine 5xx beim Code-Login', bad.join(' | '));
await browser.close();

// 2 Invitation by mail: ledger row, no duplicate for the same recipient
const { A, B, code: wg } = await setup();
const inv = await call(A, 'POST', `/api/wg/${wg}/invitations`, { email: 'gast@example.test' });
expect(
	inv.status < 300,
	'Einladung per Mail angenommen',
	`${inv.status} ${JSON.stringify(inv.body)}`,
);
const row = sql(
	`select status from mail_log where kind='invitation' order by created_at desc limit 1`,
);
expect(['sent', 'deferred', 'sending'].includes(row), 'Einladungs-Mail im Ledger', row);
const inv2 = await call(A, 'POST', `/api/wg/${wg}/invitations`, { email: 'GAST@example.test' });
expect(
	inv2.status < 300 || inv2.status === 429,
	'zweite Einladung an dieselbe Adresse ohne 5xx',
	String(inv2.status),
);
const invBad = await call(A, 'POST', `/api/wg/${wg}/invitations`, { email: 'kein-mail' });
expect(invBad.status === 400, 'ungültige Adresse 400', String(invBad.status));

// 3 Receipt upload through Supabase Storage
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
);
const sign = await call(A, 'POST', '/api/upload/sign', {
	shareCode: wg,
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: png.length,
});
expect(
	sign.status === 200 && !!sign.body.presignedUrl,
	'Upload signiert',
	JSON.stringify(sign.body).slice(0, 120),
);
const badMime = await call(A, 'POST', '/api/upload/sign', {
	shareCode: wg,
	purpose: 'expense',
	mimeType: 'text/html',
	fileSize: 10,
});
expect(badMime.status === 400, 'text/html abgelehnt', String(badMime.status));
const tooBig = await call(A, 'POST', '/api/upload/sign', {
	shareCode: wg,
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: 9 * 1024 * 1024,
});
expect(tooBig.status === 400, '9 MB abgelehnt', String(tooBig.status));
const put = await fetch(sign.body.presignedUrl, {
	method: 'PUT',
	headers: { ...sign.body.uploadHeaders, 'content-type': 'image/png' },
	body: png,
});
expect(put.status === 200, 'PUT in den Bucket', `${put.status} ${(await put.text()).slice(0, 80)}`);
const url = sign.body.publicUrl;
const readA = await A.ctx.fetch(url);
expect(
	readA.status() === 200 && readA.headers()['content-type'] === 'image/png',
	'Mitglied liest Bild',
	`${readA.status()} ${readA.headers()['content-type']}`,
);
expect((readA.headers()['cache-control'] ?? '').includes('no-store'), 'Bild ohne Cache');
const readB = await B.ctx.fetch(url);
expect(readB.status() === 200, 'Mitbewohner liest Bild', String(readB.status()));
const C = await user('Fremd');
const readC = await C.ctx.fetch(url);
const readCBody = await readC.json().catch(() => ({}));
expect(
	readC.status() === 401 && readCBody.code === 'not_a_member',
	'Fremder bekommt kein Bild (401 not_a_member, kein Sitzungs-Banner)',
	`${readC.status()} ${JSON.stringify(readCBody)}`,
);
const anon = await request.newContext({ baseURL: BASE });
const readAnon = await anon.fetch(url);
expect(readAnon.status() === 401, 'ohne Login 401', String(readAnon.status()));
const readBadKey = await A.ctx.fetch(
	`/api/upload/read?key=${encodeURIComponent('../../etc/passwd')}`,
);
expect(readBadKey.status() === 400, 'kaputter Schlüssel 400', String(readBadKey.status()));
const members = await call(A, 'GET', `/api/wg/${wg}/members`);
const ids = members.body.members.map((x) => x.id);
const ex = await call(A, 'POST', `/api/wg/${wg}/expenses`, {
	amountCents: 1000,
	description: 'Beleg',
	category: 'lebensmittel',
	paidByMemberId: ids[0],
	splits: ids.map((id) => ({ debtorMemberId: id, amountCents: 500 })),
	imageUrl: url,
});
expect(
	ex.status < 300,
	'Ausgabe mit Beleg',
	`${ex.status} ${JSON.stringify(ex.body).slice(0, 100)}`,
);
const foreign = await call(A, 'POST', `/api/wg/${wg}/expenses`, {
	amountCents: 1000,
	description: 'Fremdbild',
	category: 'lebensmittel',
	paidByMemberId: ids[0],
	splits: ids.map((id) => ({ debtorMemberId: id, amountCents: 500 })),
	imageUrl: `/api/upload/read?key=${encodeURIComponent(`manawg/${randomUUID()}/expense/${randomUUID()}.png`)}`,
});
expect(
	foreign.status === 400,
	'Bild einer anderen WG an Ausgabe abgelehnt',
	String(foreign.status),
);
const exId = ex.body.expense?.id ?? ex.body.id;
const del = await call(A, 'DELETE', `/api/wg/${wg}/expenses/${exId}`, {});
expect(del.status < 300, 'Ausgabe gelöscht', String(del.status));
const readAfter = await A.ctx.fetch(url);
expect(readAfter.status() === 404, 'Bild nach Löschen widerrufen', String(readAfter.status()));
finish();

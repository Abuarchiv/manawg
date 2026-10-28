import { chromium, devices } from '@playwright/test';
import { BASE, MAIL } from './env.mjs';

const log = [];
const bugs = [];
const note = (m) => {
	log.push(m);
};
const bug = (m) => {
	bugs.push(m);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function mails(to) {
	for (let i = 0; i < 20; i++) {
		const r = await (await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
		if (r.messages?.length) {
			const out = [];
			for (const m of r.messages) out.push(await (await fetch(`${MAIL}/message/${m.ID}`)).json());
			return out;
		}
		await wait(700);
	}
	return [];
}
const stamp = Date.now();
const A = { email: `anna${stamp}@example.test`, pw: 'Sicheres-Passwort-77', name: 'Anna' };
const B = { email: `ben${stamp}@example.test`, pw: 'Sicheres-Passwort-88', name: 'Ben' };
const browser = await chromium.launch();
function watch(page, tag) {
	page.on('pageerror', (e) => bug(`${tag} pageerror ${e.message.slice(0, 160)}`));
	page.on('console', (m) => {
		if (m.type() === 'error') bug(`${tag} console ${m.text().slice(0, 160)}`);
	});
	page.on('response', (r) => {
		if (r.status() >= 500) bug(`${tag} HTTP ${r.status()} ${r.url().replace(BASE, '')}`);
	});
}
async function ctx() {
	const c = await browser.newContext({
		...devices['iPhone 13'],
		baseURL: BASE,
		locale: 'de-DE',
		timezoneId: 'Europe/Berlin',
	});
	const p = await c.newPage();
	return { c, p };
}
async function register(p, u, tag) {
	await p.goto('/registrieren');
	await p.getByLabel('Dein Name').fill(u.name);
	await p.getByLabel('E-Mail-Adresse').fill(u.email);
	await p.getByLabel('Passwort', { exact: true }).fill(u.pw);
	await p.getByLabel('Passwort wiederholen').fill(u.pw);
	await p.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
	await wait(1500);
	note(
		`${tag} nach Registrieren: ${p.url()} | ${(await p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`,
	);
	const ms = await mails(u.email);
	const conf = ms.find((m) => /confirm|verify|signup/i.test(m.Text + m.HTML)) ?? ms[0];
	if (!conf) {
		bug(`${tag} keine Bestätigungsmail`);
		return false;
	}
	note(`${tag} Mail-Betreff: ${conf.Subject}`);
	const link = (conf.HTML.match(/href="([^"]*auth[^"]*)"/) ??
		conf.Text.match(/(http\S*verify\S*)/))?.[1]?.replace(/&amp;/g, '&');
	if (!link) {
		bug(`${tag} kein Bestätigungslink in Mail`);
		return false;
	}
	await p.goto(link);
	await wait(2000);
	note(`${tag} nach Bestätigung: ${p.url()}`);
	return true;
}
// ---- account A
const a = await ctx();
watch(a.p, 'A');
if (!(await register(a.p, A, 'A'))) process.exit(1);
const cookies = await a.c.cookies();
note(
	`A Cookies: ${cookies.map((c) => `${c.name}${c.httpOnly ? '[httpOnly]' : '[JS]'}`).join(', ')}`,
);
if (cookies.some((c) => c.name.startsWith('sb-') && !c.httpOnly)) bug('A sb-Cookie nicht HttpOnly');
await a.p.goto('/neu');
await wait(1500);
note(`A /neu: ${(await a.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
// WG erstellen
await a.p.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
const nameVal = await a.p.getByLabel('Dein Anzeigename').inputValue();
note(`A Anzeigename vorbelegt: ${JSON.stringify(nameVal)}`);
if (nameVal !== 'Anna') bug(`Name aus Registrierung nicht vorbelegt: ${nameVal}`);
await a.p.getByLabel('WG-Name').fill('Testwohnung');
await a.p.getByRole('button', { name: 'WG erstellen', exact: true }).click();
await a.p
	.waitForSelector('text=ist live', { timeout: 20000 })
	.catch(() => bug('A WG-Erstellung: kein Erfolg-Screen'));
const linkBtn = a.p.getByRole('button', { name: 'Einladungslink kopieren' });
await a.p
	.waitForFunction(() => /einladung\/[\w-]{22}/.test(document.body.innerText), null, {
		timeout: 15000,
	})
	.catch(() => {});
const inviteUrl = ((await linkBtn.textContent().catch(() => '')) ?? '').trim();
note(`A Einladungslink: ${inviteUrl}`);
if (!/einladung\/[\w-]{22}/.test(inviteUrl)) bug('Einladungslink fehlt/ungültig');
const token = inviteUrl.split('/').pop();
await a.p.screenshot({ path: `${process.env.SHOTS_DIR}/real-created.png` });
// ---- account B joins
const b = await ctx();
watch(b.p, 'B');
await b.p.goto(`/einladung/${token}`);
await wait(1200);
note(
	`B Einladung (ausgeloggt): ${(await b.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`,
);
await b.p.getByRole('link', { name: 'Konto erstellen' }).click();
await wait(500);
note(`B URL: ${b.p.url()}`);
await b.p.getByLabel('Dein Name').fill(B.name);
await b.p.getByLabel('E-Mail-Adresse').fill(B.email);
await b.p.getByLabel('Passwort', { exact: true }).fill(B.pw);
await b.p.getByLabel('Passwort wiederholen').fill(B.pw);
await b.p.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
await wait(1500);
const msB = await mails(B.email);
const confB = msB[0];
const lB = confB?.HTML.match(/href="([^"]*auth[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
if (!lB) bug('B keine Bestätigungsmail');
else {
	await b.p.goto(lB);
	await wait(2500);
}
note(`B nach Bestätigung: ${b.p.url()}`);
if (!/einladung/.test(b.p.url()))
	bug(`B landet nach Bestätigung nicht auf der Einladung: ${b.p.url()}`);
else {
	note(
		`B Beitrittsseite: ${(await b.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`,
	);
	await b.p.getByRole('button', { name: 'Beitreten', exact: true }).click();
	await wait(2500);
	note(`B nach Beitritt: ${b.p.url()}`);
	if (!/\/wg\//.test(b.p.url())) bug(`B nach Beitritt nicht in der WG: ${b.p.url()}`);
}
const wgPath = new URL(b.p.url()).pathname.split('/').slice(0, 3).join('/');
note(`WG-Pfad: ${wgPath}`);
// ---- Daten anlegen via UI: Einkauf
await a.p.goto(`${wgPath}/einkauf`);
await wait(1500);
await a.p.getByPlaceholder(/Reis/).fill('Hafermilch');
await a.p.keyboard.press('Enter');
await wait(1500);
note(`A Einkauf: ${(await a.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
await b.p.goto(`${wgPath}/einkauf`);
await wait(2000);
if (!(await b.p.locator('text=Hafermilch').count())) bug('B sieht Hafermilch von A nicht');
// Chores + expense via UI take long; load the dashboard instead
for (const sub of [
	'',
	'/ausgaben',
	'/putzen',
	'/chat',
	'/pinnwand',
	'/kalender',
	'/einstellungen',
	'/abrechnung',
	'/aktivitaet',
]) {
	for (const [who, pg] of [
		['A', a.p],
		['B', b.p],
	]) {
		await pg.goto(wgPath + sub);
		await wait(900);
		// The settings page links "Fehler per E-Mail melden"; that is not an error state.
		const t = (await pg.locator('body').innerText()).replace(/Fehler per E-Mail melden/g, '');
		if (/Fehler|konnte nicht|nicht geladen/i.test(t))
			bug(
				`${who} ${sub || '/'} zeigt Fehlertext: ${t.match(/[^\n]*(Fehler|konnte nicht|nicht geladen)[^\n]*/i)?.[0] ?? ''}`,
			);
	}
}
// ---- Abmelden + Code-Login A
await a.p.goto(`${wgPath}/einstellungen`);
await wait(1000);
await a.p.screenshot({ path: `${process.env.SHOTS_DIR}/real-settings.png` });
const out = await a.p.evaluate(
	async () =>
		(
			await fetch('/api/auth/sign-out', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
		).status,
);
note(`A sign-out status ${out}`);
await a.p.goto('/neu');
await wait(1200);
note(
	`A nach Sign-out /neu: ${(await a.p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 120)}`,
);
await a.p.getByLabel('E-Mail-Adresse').fill(A.email);
await a.p.getByRole('button', { name: 'Code per E-Mail senden' }).click();
await wait(1500);
const _before = (await mails(A.email)).length;
await wait(1500);
const codeMail = (await mails(A.email)).find((m) =>
	/\b\d{8}\b/.test(m.Text + m.HTML.replace(/<[^>]+>/g, ' ')),
);
const code = `${codeMail?.Text} ${codeMail?.HTML.replace(/<[^>]+>/g, ' ')}`.match(
	/\b(\d{8})\b/,
)?.[1];
note(`A Code-Mail: ${codeMail ? codeMail.Subject : 'KEINE'} code=${code}`);
if (!code) bug('Code-Login: keine 8-stellige Code-Mail');
else {
	await a.p.getByLabel(/stelliger Code/).fill(code);
	await a.p.getByRole('button', { name: 'Anmelden', exact: true }).click();
	await wait(2500);
	note(`A nach Code-Login: ${a.p.url()}`);
}
if (/\/neu$/.test(a.p.url()) || !/\/wg\//.test(a.p.url()))
	note(`A landet nicht automatisch in WG (ok wenn Auswahl): ${a.p.url()}`);
// Reload-Persistenz
await a.p.reload();
await wait(1500);
note(
	`A nach Reload: ${a.p.url()} signedIn-Cookie: ${(await a.c.cookies()).some((c) => c.name === 'manawg_signed_in')}`,
);
for (const entry of bugs) process.stdout.write(`- ${entry}\n`);
await browser.close();

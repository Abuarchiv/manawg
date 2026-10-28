import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit } from '@playwright/test';
import { BASE, SB } from './env.mjs';

// Drives the real UI (phone viewport) against the local real stack: every WG page, the main
// create/edit flows, two members. Writes screenshots and an aria snapshot per step to SHOTS_DIR
// and prints console errors, page errors, failed requests and visible error texts.
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
const OUT = process.env.SHOTS_DIR ?? './ui-shots';
mkdirSync(OUT, { recursive: true });
const stamp = Date.now();
const bugs = [];
const notes = [];
const bug = (m) => bugs.push(m);
const note = (m) => notes.push(m);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeUser(name) {
	const email = `${name.toLowerCase()}${stamp}@example.test`;
	const password = 'Sicheres-Passwort-77';
	await fetch(`${SB}/auth/v1/admin/users`, {
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
	return { name, email, password };
}

// BROWSER=webkit and DEVICE='Pixel 7' switch engine and viewport; default is Chromium on iPhone 13.
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
const device = devices[process.env.DEVICE ?? 'iPhone 13'];
const HARNESS_NOISE = /interactive-widget|Refused to apply a stylesheet/;
async function session(u, tag) {
	const context = await browser.newContext({ ...device, baseURL: BASE });
	const page = await context.newPage();
	page.on('pageerror', (e) => bug(`${tag} pageerror ${e.message.slice(0, 200)}`));
	page.on('console', (m) => {
		// WebKit only: it ignores the viewport key interactive-widget, and the Playwright screenshot
		// probe injects a <style> without nonce that the CSP rejects. Neither is an app fault.
		if (m.type() === 'error' && !HARNESS_NOISE.test(m.text()))
			bug(`${tag} console ${m.text().slice(0, 200)}`);
	});
	page.on('response', (r) => {
		const url = r.url().replace(BASE, '');
		if (r.status() >= 400 && !url.includes('/api/auth/')) bug(`${tag} HTTP ${r.status()} ${url}`);
	});
	const res = await page.request.post('/api/auth/sign-in', {
		data: { email: u.email, password: u.password },
		headers: { origin: BASE },
	});
	if (!res.ok()) throw new Error(`sign-in ${tag} ${res.status()}`);
	return { page, context, tag };
}

let shot = 0;
async function step(s, name, fn) {
	const id = `${String(++shot).padStart(2, '0')}-${s.tag}-${name}`;
	try {
		await fn(s.page);
		await wait(400);
		await s.page.screenshot({ path: `${OUT}/${id}.png`, fullPage: true });
		const text = (await s.page.locator('body').innerText()).replace(
			/Fehler per E-Mail melden/g,
			'',
		);
		const m = text.match(/[^\n]*(fehlgeschlagen|konnte nicht|nicht geladen|Fehler)[^\n]*/i);
		if (m) bug(`${id} shows error text: ${m[0].slice(0, 160)}`);
		note(`${id} ok`);
	} catch (e) {
		await s.page.screenshot({ path: `${OUT}/${id}-FAIL.png`, fullPage: true }).catch(() => {});
		const aria = await s.page
			.locator('body')
			.ariaSnapshot()
			.catch(() => '');
		writeFileSync(`${OUT}/${id}-aria.txt`, aria);
		bug(`${id} FAIL ${String(e.message).split('\n')[0].slice(0, 200)}`);
	}
}

const A = await session(await makeUser('Anna'), 'A');
const B = await session(await makeUser('Ben'), 'B');

// ---- create WG and invite B through the UI
let wgPath = '';
await step(A, 'login', async (p) => {
	await p.goto('/login');
	await p.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
	await p.getByLabel('WG-Name').fill('Echte WG');
	await p.getByRole('button', { name: 'WG erstellen', exact: true }).click();
	// An early submit races the account-name prefill; the stale "fehlt" error must clear by itself.
	const live = p.getByText('ist live');
	const stale = p.getByText('Dein Anzeigename fehlt.');
	await live.or(stale).first().waitFor({ timeout: 15_000 });
	if (await stale.count()) {
		await stale.waitFor({ state: 'detached', timeout: 5000 });
		await p.getByRole('button', { name: 'WG erstellen', exact: true }).click();
		await live.waitFor({ timeout: 15_000 });
	}
});
let inviteUrl = '';
await step(A, 'invite-link', async (p) => {
	const text = await p.getByRole('button', { name: 'Einladungslink kopieren' }).innerText();
	inviteUrl = text.match(/https?:\/\/\S+\/invite\/\S+/)?.[0] ?? '';
	if (!inviteUrl) throw new Error(`no invite link: ${text}`);
	await p.getByRole('button', { name: 'Zur WG', exact: true }).click();
	await p.waitForURL(/\/wg\//);
	wgPath = new URL(p.url()).pathname.replace(/\/$/, '');
});
await step(B, 'join', async (p) => {
	await p.goto(inviteUrl);
	const nameField = p.getByLabel('Dein Anzeigename');
	await nameField.waitFor();
	// The account name arrives asynchronously; a real person does not click within milliseconds.
	await p
		.waitForFunction(() => document.querySelector('input')?.value !== '', null, {
			timeout: 5000,
		})
		.catch(() => {});
	if (!(await nameField.inputValue())) bug('B join: display name not prefilled');
	await p.getByRole('button', { name: 'Beitreten', exact: true }).click();
	await p.waitForURL(/\/wg\//, { timeout: 15_000 });
});

// ---- Shopping
await step(A, 'shopping-add', async (p) => {
	await p.goto(`${wgPath}/shopping`);
	// WebKit hydrates later than Chromium; typing before hydration is lost.
	await p.waitForLoadState('networkidle');
	await p.getByPlaceholder(/Reis/).fill('Hafermilch');
	await p.keyboard.press('Enter');
	await p.getByText('Hafermilch').first().waitFor();
});
await step(B, 'shopping-check', async (p) => {
	await p.goto(`${wgPath}/shopping`);
	await p.waitForLoadState('networkidle');
	await p.getByRole('checkbox', { name: 'Hafermilch erledigen' }).click();
	await wait(800);
});
await step(A, 'shopping-after', async (p) => {
	await p.goto(`${wgPath}/shopping`);
	await p.waitForLoadState('networkidle');
});

// ---- Supplies
await step(A, 'supply-add', async (p) => {
	await p.goto(`${wgPath}/supplies`);
	await p.getByRole('button', { name: 'Vorrat hinzufügen' }).click();
	const dialog = p.getByRole('dialog');
	await dialog
		.getByLabel(/Name|Bezeichnung/)
		.first()
		.fill('Klopapier');
	await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
	await p.getByText('Klopapier').first().waitFor();
});
await step(B, 'supply-plus', async (p) => {
	await p.goto(`${wgPath}/supplies`);
	await p.getByRole('button', { name: 'Klopapier um eins erhöhen' }).click();
	await wait(800);
});

// ---- Expenses
await step(A, 'expense-add', async (p) => {
	await p.goto(`${wgPath}/expenses`);
	await p.getByRole('button', { name: 'Ausgabe hinzufügen' }).click();
	const d = p.getByRole('dialog');
	await d.getByLabel('Beschreibung', { exact: true }).fill('Wocheneinkauf');
	await d.getByLabel('Betrag', { exact: true }).fill('42,50');
	await d.getByRole('button', { name: 'Ausgabe speichern', exact: true }).click();
	await p.getByText('Wocheneinkauf').first().waitFor();
});
await step(B, 'expenses-view', async (p) => {
	await p.goto(`${wgPath}/expenses`);
	await p.getByText('Wocheneinkauf').first().waitFor();
});
await step(A, 'recurring-add', async (p) => {
	await p.goto(`${wgPath}/recurring`);
	await p.getByRole('button', { name: 'Fixkosten hinzufügen' }).click();
	const d = p.getByRole('dialog');
	await d.getByLabel('Beschreibung', { exact: true }).fill('Internet');
	await d.getByLabel('Betrag', { exact: true }).fill('40');
	await d.getByRole('button', { name: 'Fixkosten anlegen', exact: true }).click();
	await p.getByText('Internet').first().waitFor();
});
await step(B, 'statement', async (p) => {
	await p.goto(`${wgPath}/statement`);
	await p.waitForLoadState('networkidle');
});
await step(A, 'reminders', async (p) => {
	await p.goto(`${wgPath}/reminders`);
	await p.waitForLoadState('networkidle');
});

// ---- Chores
await step(A, 'chores-add', async (p) => {
	await p.goto(`${wgPath}/chores`);
	await p.getByRole('button', { name: 'Putzaufgabe hinzufügen' }).click();
	const d = p.getByRole('dialog');
	await d.getByLabel('Aufgabe', { exact: true }).fill('Bad putzen');
	await d.getByRole('button', { name: 'Speichern' }).click();
	await p.getByText('Bad putzen').first().waitFor();
});
await step(A, 'chores-done', async (p) => {
	await p.goto(`${wgPath}/chores`);
	await p
		.getByRole('button', {
			name: /Als erledigt markieren: Bad putzen|Erledigt: Bad putzen|Erledigt bestätigen: Bad putzen/,
		})
		.first()
		.click();
	await wait(600);
	const confirm = p.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' });
	if (await confirm.count()) await confirm.click();
	await wait(800);
});

// ---- Calendar
await step(A, 'calendar-add', async (p) => {
	await p.goto(`${wgPath}/calendar`);
	const add = p
		.getByRole('button', { name: /Termin hinzufügen|Neuer Termin|Termin anlegen/ })
		.first();
	if (await add.count()) await add.click();
	await p.getByLabel('Titel').fill('Hausversammlung');
	await p.getByRole('button', { name: 'Termin speichern' }).click();
	await p.getByText('Hausversammlung').first().waitFor();
});
await step(B, 'calendar-agenda', async (p) => {
	await p.goto(`${wgPath}/calendar`);
	await p.getByRole('tab', { name: 'Agenda' }).click();
	await wait(500);
});

// ---- Pinboard
await step(A, 'pinboard-add', async (p) => {
	await p.goto(`${wgPath}/pinboard`);
	await p.getByRole('button', { name: 'Beitrag hinzufügen' }).click();
	await p.getByRole('textbox').first().fill('Wer hat den Schlüssel?');
	await p
		.getByRole('button', { name: /Veröffentlichen|Beitrag speichern|Posten|Speichern/ })
		.first()
		.click();
	await p.getByText('Wer hat den Schlüssel?').first().waitFor();
});
await step(B, 'pinboard-reply', async (p) => {
	await p.goto(`${wgPath}/pinboard`);
	// The post is server-rendered: wait for hydration, otherwise the click is lost.
	await p.waitForLoadState('networkidle');
	await p
		.getByRole('button', { name: /^Antworten anzeigen:/ })
		.first()
		.click();
	await p
		.getByRole('textbox', { name: /^Antwort verfassen:/ })
		.first()
		.fill('Ich!');
	await p
		.getByRole('button', { name: /^Antworten:/ })
		.first()
		.click();
	await p.getByText('Ich!', { exact: true }).first().waitFor();
});

// ---- Chat
await step(A, 'chat-send', async (p) => {
	await p.goto(`${wgPath}/chat`);
	await p.getByRole('textbox', { name: 'Chat-Nachricht' }).fill('Hallo zusammen');
	await p.getByRole('button', { name: 'Nachricht senden' }).click();
	await p.getByText('Hallo zusammen').first().waitFor();
});
await step(B, 'chat-read', async (p) => {
	await p.goto(`${wgPath}/chat`);
	await p.getByText('Hallo zusammen').first().waitFor();
});

// ---- Dashboard, activity, import, settings
await step(B, 'dashboard', async (p) => {
	await p.goto(wgPath);
	await p.waitForLoadState('networkidle');
});
await step(A, 'activity', async (p) => {
	await p.goto(`${wgPath}/activity`);
	await p.waitForLoadState('networkidle');
});
await step(A, 'import', async (p) => {
	await p.goto(`${wgPath}/import`);
	await p.waitForLoadState('networkidle');
});
await step(A, 'settings', async (p) => {
	await p.goto(`${wgPath}/settings`);
	await p.waitForLoadState('networkidle');
});
await step(B, 'rename', async (p) => {
	await p.goto(`${wgPath}/settings`);
	await p.getByLabel('Dein Name', { exact: true }).fill('Benjamin');
	await p.getByRole('button', { name: 'Speichern', exact: true }).first().click();
	await p.getByText('Name gespeichert.').waitFor();
});
await step(A, 'wg-name', async (p) => {
	await p.goto(`${wgPath}/settings`);
	await p.getByLabel('Name eurer WG').fill('Echte WG 2');
	await p.getByLabel('Name eurer WG').press('Enter');
	await p.getByText('WG-Name gespeichert.').waitFor();
});
await step(A, 'dashboard-final', async (p) => {
	await p.goto(wgPath);
	await p.waitForLoadState('networkidle');
});

process.stdout.write(`steps=${shot} bugs=${bugs.length}\n`);
for (const n of notes) process.stdout.write(`+ ${n}\n`);
for (const b of bugs) process.stdout.write(`- ${b}\n`);
await browser.close();

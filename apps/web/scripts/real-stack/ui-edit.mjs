// Second UI pass on the phone viewport: action sheets, edit and delete flows, settings tabs,
// dark mode, long texts and the empty states left behind. Same env and output as ui.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit } from '@playwright/test';
import { BASE } from './env.mjs';
import { DAY, iso, setup } from './modules-lib.mjs';
import { seed } from './ui-edit-seed.mjs';

const OUT = process.env.SHOTS_DIR ?? './ui-edit-shots';
mkdirSync(OUT, { recursive: true });
const bugs = [];
const notes = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG = 'Sehr langer Text ohne Umbruchmöglichkeit_'.repeat(3);
const SHORT = LONG.slice(0, 30);

const { A, B, code, annaId, benId } = await setup();
const wg = `/wg/${code}`;
await seed({ A, B, code, annaId, benId, LONG });

// BROWSER=webkit and DEVICE='Pixel 7' switch engine and viewport; default is Chromium on iPhone 13.
const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch();
const device = devices[process.env.DEVICE ?? 'iPhone 13'];
const HARNESS_NOISE = /interactive-widget|Refused to apply a stylesheet/;
async function session(u, tag) {
	const context = await browser.newContext({ ...device, baseURL: BASE });
	const page = await context.newPage();
	page.on('pageerror', (e) => bugs.push(`${tag} pageerror ${e.message.slice(0, 200)}`));
	page.on('console', (m) => {
		// WebKit only: it ignores the viewport key interactive-widget, and the Playwright screenshot
		// probe injects a <style> without nonce that the CSP rejects. Neither is an app fault.
		if (m.type() === 'error' && !HARNESS_NOISE.test(m.text()))
			bugs.push(`${tag} console ${m.text().slice(0, 200)}`);
	});
	page.on('response', (r) => {
		const url = r.url().replace(BASE, '');
		if (r.status() >= 400 && !url.includes('/api/auth/'))
			bugs.push(`${tag} HTTP ${r.status()} ${url}`);
	});
	await page.request.post('/api/auth/sign-in', {
		data: { email: u.email, password: 'Sicheres-Passwort-77' },
		headers: { origin: BASE },
	});
	return { page, tag };
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
		if (m) bugs.push(`${id} shows error text: ${m[0].slice(0, 160)}`);
		notes.push(`${id} ok`);
	} catch (e) {
		await s.page.screenshot({ path: `${OUT}/${id}-FAIL.png`, fullPage: true }).catch(() => {});
		writeFileSync(
			`${OUT}/${id}-aria.txt`,
			await s.page
				.locator('body')
				.ariaSnapshot()
				.catch(() => ''),
		);
		writeFileSync(`${OUT}/${id}-error.txt`, String(e.stack ?? e.message));
		bugs.push(`${id} FAIL ${String(e.message).split('\n')[0].slice(0, 200)}`);
	}
}
const open = async (p, path) => {
	await p.goto(`${wg}${path}`);
	await p.waitForLoadState('networkidle');
};
/** Action sheets are dialogs on some pages and menus on others. */
const actions = async (p, name) => {
	await p.getByRole('button', { name }).first().click();
	await p.getByRole('dialog').or(p.getByRole('menu')).first().waitFor();
};
const pick = async (p, re) =>
	p
		.getByRole('menuitem', { name: re })
		.or(p.getByRole('dialog').getByRole('button', { name: re }))
		.filter({ visible: true })
		.first()
		.click();
/** Confirms a destructive alert dialog or an inline armed "Endgültig" button when one shows up. */
const confirm = async (p) => {
	const dlg = p.getByRole('alertdialog');
	const armed = p.getByRole('button', { name: /^Endgültig entfernen/ });
	await dlg
		.or(armed)
		.first()
		.waitFor({ timeout: 2500 })
		.catch(() => null);
	if (await dlg.count())
		await dlg
			.getByRole('button', { name: /entfernen|löschen|bestätigen|^ja$/i })
			.first()
			.click();
	else if (await armed.count()) await armed.first().click();
};
/** Toasts may repeat the name, so only list rows count. */
const gone = (p, text) =>
	p.getByRole('listitem').filter({ hasText: text }).first().waitFor({ state: 'detached' });

const a = await session(A, 'A');
const b = await session(B, 'B');

// ---- Shopping: action sheet, rename to a long name, delete
await step(a, 'shopping-sheet', async (p) => {
	await open(p, '/shopping');
	await actions(p, /^Artikelaktionen: Hafermilch/);
});
await step(a, 'shopping-edit-long', async (p) => {
	await pick(p, /^Bearbeiten$/i);
	const box = p.getByRole('dialog').getByRole('textbox').first();
	await box.fill(LONG);
	await p
		.getByRole('dialog')
		.getByRole('button', { name: /speichern|übernehmen/i })
		.first()
		.click();
	await p.getByText(SHORT).first().waitFor();
});
await step(a, 'shopping-delete-empty', async (p) => {
	await actions(p, /^Artikelaktionen:/);
	await pick(p, /entfernen|löschen/i);
	await confirm(p);
	await gone(p, SHORT);
});

// ---- Supplies: edit dialog, long name, remove, empty state
await step(a, 'supply-edit', async (p) => {
	await open(p, '/supplies');
	await p.getByRole('button', { name: 'Klopapier bearbeiten' }).click();
	await p.getByRole('dialog').waitFor();
});
await step(a, 'supply-edit-long', async (p) => {
	await p.getByRole('dialog').getByRole('textbox').first().fill(LONG);
	await p
		.getByRole('dialog')
		.getByRole('button', { name: /speichern/i })
		.first()
		.click();
	await p.getByText(SHORT).first().waitFor();
});
await step(a, 'supply-remove-empty', async (p) => {
	await p
		.getByRole('button', { name: / entfernen$/ })
		.filter({ visible: true })
		.first()
		.click();
	await confirm(p);
	await gone(p, SHORT);
});

// ---- Chore plan: action sheet, edit, distribution panel, absence dialog, delete, empty
await step(a, 'chores-sheet', async (p) => {
	await open(p, '/chores');
	await actions(p, /^Aufgabenaktionen: Bad putzen/);
});
await step(a, 'chores-edit-long', async (p) => {
	await pick(p, /^Aufgabe bearbeiten/);
	const d = p.getByRole('dialog', { name: /bearbeiten/i });
	await d.getByLabel('Aufgabe').fill(LONG);
	await d
		.getByRole('button', { name: /speichern/i })
		.first()
		.click();
	await p.getByText(SHORT).first().waitFor();
});
await step(a, 'chores-rotation', async (p) => {
	await p.getByRole('button', { name: 'So wird verteilt' }).click();
	await wait(500);
});
await step(a, 'chores-absence', async (p) => {
	await p.getByRole('button', { name: 'Abwesenheit eintragen' }).click();
	await p.getByRole('button', { name: 'Abwesenheitsformular schließen' }).waitFor();
});
await step(a, 'chores-absence-save', async (p) => {
	await p.getByLabel('Abwesenheit von').fill(iso(DAY).slice(0, 10));
	await p.getByLabel('Abwesenheit bis').fill(iso(3 * DAY).slice(0, 10));
	await p.getByRole('button', { name: 'Abwesenheit speichern' }).click();
	await p.getByRole('button', { name: /^Abwesenheit von .* entfernen$/ }).waitFor();
});
await step(a, 'chores-delete-empty', async (p) => {
	await actions(p, /^Aufgabenaktionen:/);
	await pick(p, /^Aufgabe entfernen/);
	await confirm(p);
	await gone(p, SHORT);
});

// ---- Expenses: details, action sheet, edit, settle, delete
await step(a, 'expense-details', async (p) => {
	await open(p, '/expenses');
	await p.getByRole('button', { name: /^Details öffnen: Wocheneinkauf/ }).click();
	await p.getByRole('button', { name: /^Als bezahlt markieren/ }).waitFor();
});
await step(a, 'expense-sheet', async (p) => {
	await actions(p, 'Aktionen für Wocheneinkauf');
});
await step(a, 'expense-edit-form', async (p) => {
	await pick(p, /bearbeiten/i);
	await p.getByLabel('Beschreibung').waitFor();
});
await step(a, 'expense-edit-save', async (p) => {
	await p.getByLabel('Beschreibung').fill(LONG);
	await p.getByLabel('Betrag').fill('99999,99');
	await p.getByRole('button', { name: 'Ausgabe speichern' }).click();
	await p.getByText(SHORT).first().waitFor();
});
await step(b, 'expense-b-balance', async (p) => {
	await open(p, '/expenses');
});
await step(b, 'settle-dialog', async (p) => {
	await p.getByRole('button', { name: 'Ausgleichen' }).first().click();
	await p.getByRole('alertdialog').waitFor();
});
await step(b, 'settle-confirm', async (p) => {
	await p
		.getByRole('alertdialog')
		.getByRole('button', { name: /bar eintragen/i })
		.first()
		.click();
	await p.getByRole('alertdialog').waitFor({ state: 'detached' });
	await wait(800);
});
await step(a, 'expense-delete-empty', async (p) => {
	await open(p, '/expenses');
	await actions(p, /^Aktionen für/);
	await pick(p, /entfernen|löschen/i);
	await confirm(p);
	await wait(800);
});

// ---- Recurring expenses: details, pause, delete
await step(a, 'recurring-details', async (p) => {
	await open(p, '/recurring');
	await p.getByRole('button', { name: /^Details öffnen: Internet/ }).click();
	await p.getByRole('button', { name: 'Internet löschen' }).waitFor();
});
await step(a, 'recurring-pause', async (p) => {
	await p.getByRole('button', { name: /^Pausieren: Internet/ }).click();
	await wait(800);
});
await step(a, 'recurring-delete-empty', async (p) => {
	await p.getByRole('button', { name: 'Pausiert' }).click();
	await p.getByRole('button', { name: /^Details öffnen: Internet/ }).click();
	await p.getByRole('button', { name: 'Internet löschen' }).click();
	await confirm(p);
	await p.getByRole('status').filter({ hasText: '0 Fixkosten sichtbar' }).waitFor();
});

// ---- Statement: month navigation
await step(a, 'statement-prev', async (p) => {
	await open(p, '/statement');
	await p.getByRole('button', { name: 'Vorheriger Monat' }).click();
	await wait(600);
});
await step(a, 'statement-next', async (p) => {
	await p.getByRole('button', { name: 'Nächster Monat' }).click();
	await p.getByRole('button', { name: 'Nächster Monat' }).click();
	await wait(600);
});

// ---- Calendar: edit dialog, month view, delete
await step(a, 'calendar-edit', async (p) => {
	await open(p, '/calendar');
	await p.getByRole('button', { name: /^Hausversammlung / }).click();
	await p.getByRole('dialog').waitFor();
});
await step(a, 'calendar-edit-long', async (p) => {
	await p.getByRole('dialog').getByLabel('Titel').fill(LONG);
	await p.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
	await p.getByText(SHORT).first().waitFor();
});
await step(a, 'calendar-month', async (p) => {
	await p.getByRole('tab', { name: 'Monat' }).click();
	await wait(600);
});
await step(a, 'calendar-delete-empty', async (p) => {
	await p.getByRole('tab', { name: 'Agenda' }).click();
	await p.getByRole('button').filter({ hasText: LONG }).click();
	await p.getByRole('dialog').getByRole('button', { name: 'Termin löschen' }).click();
	await confirm(p);
	await p.getByRole('button').filter({ hasText: LONG }).waitFor({ state: 'detached' });
});

// ---- Pinboard: menu, edit, resolve, empty
await step(a, 'pinboard-menu', async (p) => {
	await open(p, '/pinboard');
	await actions(p, /^Beitragsaktionen:/);
});
await step(a, 'pinboard-edit-long', async (p) => {
	await pick(p, /^Beitrag bearbeiten/);
	await p.getByRole('textbox').first().fill(LONG);
	await p
		.getByRole('button', { name: /speichern|übernehmen/i })
		.first()
		.click();
	await p.getByText(SHORT).first().waitFor();
});
await step(a, 'pinboard-resolve-empty', async (p) => {
	await actions(p, /^Beitragsaktionen:/);
	await pick(p, /^Als geklärt markieren/);
	await confirm(p);
	await gone(p, SHORT);
});

// ---- Chat: long message, actions, edit, delete
await step(a, 'chat-long', async (p) => {
	await open(p, '/chat');
	await actions(p, /^Aktionen für Nachricht von Anna/);
});
await step(a, 'chat-edit', async (p) => {
	await pick(p, /bearbeiten/i);
	await p
		.getByRole('textbox', { name: 'Nachricht bearbeiten' })
		.fill('Hallo zusammen (bearbeitet)');
	await p.getByRole('button', { name: 'Speichern' }).click();
	await p.getByText('(bearbeitet)').first().waitFor();
});
await step(a, 'chat-delete', async (p) => {
	await actions(p, /^Aktionen für Nachricht von Anna/);
	await pick(p, /entfernen|löschen/i);
	await confirm(p);
	await wait(800);
});

// ---- Settings tabs + dark mode
await step(a, 'settings-notifications', async (p) => {
	await open(p, '/settings');
	await p.getByRole('tab', { name: 'Benachrichtigungen', exact: true }).click();
	await wait(500);
});
await step(a, 'settings-access', async (p) => {
	await p.getByRole('tab', { name: 'Zugang' }).click();
	await wait(500);
});
await step(a, 'settings-data', async (p) => {
	await p.getByRole('tab', { name: 'Daten' }).click();
	await wait(500);
});
await step(a, 'dark-on', async (p) => {
	await p.getByRole('tab', { name: 'Profil' }).click();
	await p.getByRole('button', { name: 'Dunkel' }).click();
	await wait(400);
});
await step(a, 'dark-dashboard', async (p) => open(p, ''));
await step(b, 'dark-b-chat', async (p) => {
	await open(p, '/settings');
	await p.getByRole('button', { name: 'Dunkel' }).click();
	await open(p, '/chat');
});
await step(b, 'dark-b-activity', async (p) => {
	await open(p, '/activity');
	await p.getByRole('searchbox').fill('Klopapier');
	await wait(700);
});
await step(a, 'light-back', async (p) => {
	await open(p, '/settings');
	await p.getByRole('button', { name: 'Hell' }).click();
	await wait(300);
});

process.stdout.write(`steps=${shot} bugs=${bugs.length}\n`);
for (const n of notes) process.stdout.write(`+ ${n}\n`);
for (const entry of bugs) process.stdout.write(`- ${entry}\n`);
await browser.close();
if (bugs.length > 0) process.exitCode = 1;

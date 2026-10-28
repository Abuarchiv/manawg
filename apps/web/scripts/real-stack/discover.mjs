// Lists every interactive element (role + name) per WG page in the phone viewport, so UI drivers
// can be written against real labels. Prints to stdout; same env as ui.mjs.
import { chromium, devices } from '@playwright/test';
import { BASE } from './env.mjs';
import { call, setup } from './modules-lib.mjs';

const { A, code, annaId, benId } = await setup();
// Some data so lists, menus and edit controls render.
await call(A, 'POST', `/api/wg/${code}/expenses`, {
	amountCents: 4250,
	description: 'Wocheneinkauf',
	category: 'lebensmittel',
	paidByMemberId: annaId,
	splits: [
		{ debtorMemberId: annaId, amountCents: 2125 },
		{ debtorMemberId: benId, amountCents: 2125 },
	],
});
await call(A, 'POST', `/api/wg/${code}/shopping`, { name: 'Hafermilch', quantity: '2' });
await call(A, 'POST', `/api/wg/${code}/inventory`, {
	name: 'Klopapier',
	quantity: 1,
	threshold: 2,
	category: 'putzmittel',
});
await call(A, 'POST', `/api/wg/${code}/chores`, {
	title: 'Bad putzen',
	intervalDays: 7,
	assignedMemberId: annaId,
});
await call(A, 'POST', `/api/wg/${code}/events`, {
	title: 'Hausversammlung',
	startsAt: new Date(Date.now() + 86_400_000).toISOString(),
	endsAt: new Date(Date.now() + 90_000_000).toISOString(),
});
await call(A, 'POST', `/api/wg/${code}/announcements`, {
	content: 'Wer hat den Schlüssel?',
	kind: 'info',
});
await call(A, 'POST', `/api/wg/${code}/chat/messages`, { body: 'Hallo zusammen' });
await call(A, 'POST', `/api/wg/${code}/recurring-expenses`, {
	description: 'Internet',
	category: 'wohnen',
	amountCents: 4000,
	paidByMemberId: annaId,
	intervalMonths: 1,
	nextDueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
	splits: [
		{ debtorMemberId: annaId, amountCents: 2000 },
		{ debtorMemberId: benId, amountCents: 2000 },
	],
});

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
const page = await context.newPage();
await page.request.post('/api/auth/sign-in', {
	data: { email: A.email, password: 'Sicheres-Passwort-77' },
	headers: { origin: BASE },
});
const pages = [
	'',
	'/einkauf',
	'/vorraete',
	'/putzen',
	'/ausgaben',
	'/abos',
	'/abrechnung',
	'/mahnungen',
	'/kalender',
	'/pinnwand',
	'/chat',
	'/aktivitaet',
	'/import',
	'/einstellungen',
	'/einstellungen?tab=hinweise',
	'/einstellungen?tab=zugang',
	'/einstellungen?tab=daten',
	'/mitglieder',
	'/einladungen',
];
for (const sub of pages) {
	await page.goto(`/wg/${code}${sub}`);
	await page.waitForLoadState('networkidle').catch(() => {});
	const aria = await page
		.locator('main')
		.ariaSnapshot()
		.catch(() => '');
	const controls = aria
		.split('\n')
		.filter((l) =>
			/^\s*-\s*'?(button|link|textbox|checkbox|combobox|tab|switch|radio|menuitem|searchbox|spinbutton|slider)\b/.test(
				l,
			),
		)
		.map((l) => l.trim().replace(/^- /, ''));
	process.stdout.write(
		`\n### ${sub || '/'} (${page.url().replace(BASE, '')})\n${controls.join('\n')}\n`,
	);
}
await browser.close();
process.stdout.write(`\nWG ${code}\n`);

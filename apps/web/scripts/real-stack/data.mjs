// Data-path checks against the real stack: Splitwise import, export, Berlin month boundary
// in the statement, and a load pass with hundreds of rows. Same env as modules.mjs.
import { chromium, devices } from '@playwright/test';
import { BASE, call, expect, finish, setup } from './modules-lib.mjs';

const { A, B, code, annaId, benId } = await setup();
const api = `/api/wg/${code}`;

// ---- 1. Splitwise CSV import: preview, commit, duplicate commit
const csv = [
	'Date,Description,Category,Cost,Currency,Anna,Ben',
	'2026-10-03,Pizza,Essen,20.00,EUR,10.00,-10.00',
	'2026-10-04,Strom,Wohnen,60.00,EUR,-30.00,30.00',
	'2026-10-05,Dollar,Sonst,5.00,USD,2.50,-2.50',
].join('\n');
const mapping = { Anna: annaId, Ben: benId };
const pv = await call(A, 'POST', `${api}/imports/preview`, {
	source: 'splitwise_csv',
	payload: csv,
	memberMapping: mapping,
});
expect(pv.status === 200, 'Import: preview', JSON.stringify(pv.body).slice(0, 300));
expect(
	pv.body.parsed?.length === 2 && pv.body.rejected?.length === 1,
	'Import: 2 rows valid, USD row rejected',
	`parsed=${pv.body.parsed?.length} rejected=${JSON.stringify(pv.body.rejected).slice(0, 200)}`,
);
const cm = await call(A, 'POST', `${api}/imports/commit`, {
	source: 'splitwise_csv',
	payload: csv,
	memberMapping: pv.body.memberMapping ?? mapping,
	previewPayloadHash: pv.body.payloadHash,
});
expect(cm.status < 300, 'Import: commit', JSON.stringify(cm.body).slice(0, 300));
const afterImport = await call(A, 'GET', `${api}/expenses`);
const pizza = afterImport.body.expenses?.find((e) => e.description === 'Pizza');
const electricity = afterImport.body.expenses?.find((e) => e.description === 'Strom');
expect(
	pizza?.amountCents === 2000 &&
		pizza.paidByMemberId === annaId &&
		pizza.splits?.some((s) => s.debtorMemberId === benId && s.amountCents === 1000),
	'Import: Pizza 20 € paid by Anna, Ben owes 10 €',
	JSON.stringify(pizza).slice(0, 300),
);
expect(
	electricity?.amountCents === 6000 &&
		electricity.paidByMemberId === benId &&
		electricity.splits?.some((s) => s.debtorMemberId === annaId && s.amountCents === 3000),
	'Import: Strom 60 € paid by Ben, Anna owes 30 €',
	JSON.stringify(electricity).slice(0, 300),
);
const cm2 = await call(A, 'POST', `${api}/imports/commit`, {
	source: 'splitwise_csv',
	payload: csv,
	memberMapping: pv.body.memberMapping ?? mapping,
	previewPayloadHash: pv.body.payloadHash,
});
const afterDup = await call(A, 'GET', `${api}/expenses`);
expect(
	cm2.status < 300 && afterDup.body.expenses?.length === afterImport.body.expenses?.length,
	'Import: second commit creates no duplicates',
	`${cm2.status} ${JSON.stringify(cm2.body).slice(0, 200)} before=${afterImport.body.expenses?.length} after=${afterDup.body.expenses?.length}`,
);

// ---- 2. Export JSON and CSV contain the imported rows
const exJson = await call(A, 'GET', `${api}/export`);
expect(
	exJson.status === 200 && JSON.stringify(exJson.body).includes('Pizza'),
	'Export JSON contains Pizza',
	JSON.stringify(exJson.body).slice(0, 200),
);
const exCsvRes = await A.ctx.fetch(`${api}/export?format=csv&section=expenses`);
const exCsv = await exCsvRes.text();
const csvLines = exCsv.trim().split('\n');
expect(
	exCsvRes.status() === 200 &&
		csvLines.length >= 3 &&
		exCsv.includes('Pizza') &&
		exCsv.includes('Strom'),
	'Export CSV: header + 2 rows with Pizza and Strom',
	`${exCsvRes.status()} ${exCsv.slice(0, 300)}`,
);
// Column count per line with quoted fields respected (splits carry ';' inside quotes).
const columns = (line) => line.replace(/"[^"]*"/g, 'q').split(';').length;
expect(
	new Set(csvLines.map(columns)).size === 1,
	'Export CSV: all rows have the same column count',
	csvLines.map(columns).join(','),
);

// ---- 3. Berlin month boundary in the statement
const mk = (d, desc) =>
	call(A, 'POST', `${api}/expenses`, {
		description: desc,
		category: 'other',
		amountCents: 1000,
		paidByMemberId: annaId,
		occurredAt: d,
		splits: [
			{ debtorMemberId: annaId, amountCents: 500 },
			{ debtorMemberId: benId, amountCents: 500 },
		],
	});
const r1 = await mk('2026-08-31T22:30:00.000Z', 'GrenzeSeptAnfang'); // Sep 1 00:30 Berlin
const r2 = await mk('2026-09-30T21:59:00.000Z', 'GrenzeSeptEnde'); // Sep 30 23:59 Berlin
const r3 = await mk('2026-09-30T22:30:00.000Z', 'GrenzeOktAnfang'); // Oct 1 00:30 Berlin
expect(
	r1.status < 300 && r2.status < 300 && r3.status < 300,
	'Month boundary: three expenses created',
	`${r1.status} ${r2.status} ${r3.status}`,
);
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], baseURL: BASE });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror ${e.message.slice(0, 160)}`));
page.on('console', (m) => {
	if (m.type() === 'error') consoleErrors.push(`console ${m.text().slice(0, 160)}`);
});
await page.request.post('/api/auth/sign-in', {
	data: { email: A.email, password: 'Sicheres-Passwort-77' },
	headers: { origin: BASE },
});
const statementText = async (month) => {
	await page.goto(`/wg/${code}/statement?month=${month}`);
	await page.waitForLoadState('networkidle');
	await page.getByRole('heading', { level: 1 }).or(page.getByText(/2026/)).first().waitFor();
	return (await page.locator('main').innerText()).replace(/\s+/g, ' ');
};
const sept = await statementText('2026-09');
const aug = await statementText('2026-08');
const oct = await statementText('2026-10');
expect(
	sept.includes('GrenzeSeptAnfang') &&
		sept.includes('GrenzeSeptEnde') &&
		!sept.includes('GrenzeOktAnfang'),
	'Statement September: Sep 1 00:30 and Sep 30 23:59 Berlin in, Oct 1 00:30 not',
	sept.slice(0, 400),
);
expect(
	!aug.includes('GrenzeSeptAnfang'),
	'Statement August: Sep 1 00:30 Berlin not in',
	aug.slice(0, 300),
);
expect(
	oct.includes('GrenzeOktAnfang') && oct.includes('Pizza'),
	'Statement October: Oct 1 00:30 Berlin and import in',
	oct.slice(0, 300),
);
const septSum = sept.match(/Gesamt\s+([\d.,]+)\s*€/)?.[1];
expect(septSum === '20,00', 'Statement September: total 20,00 €', septSum ?? sept.slice(0, 200));

await import('./data-load.mjs').then((m) =>
	m.run({ A, B, code, annaId, benId, page, consoleErrors }),
);
await browser.close();
finish();

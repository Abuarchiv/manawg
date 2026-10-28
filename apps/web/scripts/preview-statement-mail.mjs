// Renders the three statement mail variants and screenshots them.
// Usage: node --experimental-strip-types --import ./tests/support/register.mjs scripts/preview-statement-mail.mjs [outDir]
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMonthlyStatement } from '../src/features/expenses/monthly-statement.ts';
import { renderStatementMail } from '../src/features/expenses/statement-mail.ts';

const log = (line) => process.stdout.write(`${line}\n`);
const out = process.argv[2] ?? resolve(tmpdir(), 'manawg-statement-preview');

const members = [
	{ id: 'L', name: 'Lina', active: true },
	{ id: 'J', name: 'Jonas', active: true },
	{ id: 'M', name: 'Mira', active: true },
];
const split = (shares, settledAt) =>
	Object.entries(shares).map(([debtorMemberId, amountCents]) => ({
		debtorMemberId,
		amountCents,
		settledAt,
	}));
const expense = (id, paidByMemberId, amountCents, shares, settledAt = null) => ({
	id,
	paidByMemberId,
	amountCents,
	currency: 'EUR',
	description: id,
	occurredAt: '2026-09-12T10:00:00Z',
	splits: split(shares, settledAt),
});

const open = buildMonthlyStatement(
	[
		expense('Miete', 'L', 128460, { L: 42820, J: 42820, M: 42820 }),
		expense('Einkauf', 'J', 2340, { L: 780, J: 780, M: 780 }),
	],
	members,
	'2026-09',
);
const settled = buildMonthlyStatement(
	[expense('Miete', 'L', 128460, { L: 42820, J: 42820, M: 42820 }, '2026-10-01T00:00:00Z')],
	members,
	'2026-09',
);
const variants = {
	settled: { statement: settled, memberId: 'J' },
	'owed-to-you': { statement: open, memberId: 'L' },
	'you-owe': { statement: open, memberId: 'M' },
};

await mkdir(out, { recursive: true });
const markDir = pathToFileURL(resolve(import.meta.dirname, '../public/email/')).href;
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 680, height: 800 }, deviceScaleFactor: 2 });
for (const [name, variant] of Object.entries(variants)) {
	const mail = renderStatementMail({
		wgName: 'Kastanienallee',
		shareCode: 'KST4821X',
		unsubscribeUrl: 'https://app.manawg.com/api/email/unsubscribe?t=preview',
		...variant,
	});
	const file = resolve(out, `${name}.html`);
	await writeFile(file, mail.html.replaceAll('https://app.manawg.com/email/', `${markDir}/`));
	await writeFile(resolve(out, `${name}.txt`), mail.text);
	await page.goto(pathToFileURL(file).href);
	await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
	log(`${name}: ${mail.subject} | ${mail.preheader}`);
}
await browser.close();
log(`-> ${out}`);

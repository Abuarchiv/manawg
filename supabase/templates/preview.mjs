// Renders the templates with sample data and screenshots them.
// Usage: node supabase/templates/preview.mjs [email] [token] [outDir]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const log = (line) => process.stdout.write(`${line}\n`);

const [
	email = 'lina@posteo.de',
	token = '48291374',
	out = resolve(tmpdir(), 'manawg-mail-preview'),
] = process.argv.slice(2);
const urls = {
	'.ConfirmationURL':
		'https://bwsvsvfgbrsonepffqff.supabase.co/auth/v1/verify?token=8f3a1c9e4b7d&type=signup&redirect_to=https://app.manawg.com/auth/callback',
	'.SiteURL': 'https://app.manawg.com',
	'.NewEmail': 'lina.neu@posteo.de',
	'.Email': email,
};
// The mark is only hosted after deploy; point the preview at the local file.
const markDir = pathToFileURL(resolve(import.meta.dirname, '../../apps/web/public/email/')).href;
const render = (s) =>
	s
		.replaceAll('https://app.manawg.com/email/', `${markDir}/`)
		.replace(/\{\{\s*slice \.Token (\d+) (\d+)\s*\}\}/g, (_, a, b) => token.slice(+a, +b))
		.replace(/\{\{\s*\.Token\s*\}\}/g, token)
		.replace(/\{\{\s*(\.\w+)\s*\}\}/g, (m, k) => urls[k] ?? m);

const dir = import.meta.dirname;
const subjects = JSON.parse(await readFile(resolve(dir, 'subjects.json'), 'utf8'));
await mkdir(out, { recursive: true });

const { chromium } = await import(
	process.env.PLAYWRIGHT_INDEX ??
		'/Users/abu/Company/manawg-app/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.mjs'
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 680, height: 800 }, deviceScaleFactor: 2 });
for (const name of Object.keys(subjects)) {
	const html = render(await readFile(resolve(dir, `${name}.html`), 'utf8'));
	if (/\{\{/.test(html)) throw new Error(`${name}: unresolved template variable`);
	const file = resolve(out, `${name}.html`);
	await writeFile(file, html);
	await page.goto(pathToFileURL(file).href);
	await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
	log(`${name}: ${render(subjects[name])}`);
}
await browser.close();
log(`-> ${out}`);

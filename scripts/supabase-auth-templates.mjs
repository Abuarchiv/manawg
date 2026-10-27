// Pushes supabase/templates/* to the hosted Supabase Auth config.
// Usage: node scripts/supabase-auth-templates.mjs --ref <ref> [--app-url <url>] [--legal-url <url>] [--apply]
// --app-url / --legal-url replace the official origins in the templates (defaults:
// https://app.manawg.com and https://manawg.com). Without --apply: dry-run (prints what would
// be sent). --apply needs SUPABASE_ACCESS_TOKEN.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const log = (line) => process.stdout.write(`${line}\n`);

const dir = resolve(import.meta.dirname, '../supabase/templates');
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	const value = index >= 0 ? args[index + 1] : undefined;
	return value && !value.startsWith('--') ? value : fallback;
};
const ref = option('--ref');
if (!ref) {
	console.error('Missing --ref <project-ref> (Supabase dashboard: Project Settings > General).');
	process.exit(1);
}
const appUrl = new URL(option('--app-url', 'https://app.manawg.com')).origin;
const legalUrl = new URL(option('--legal-url', 'https://manawg.com')).origin;
const apply = args.includes('--apply');

const subjects = JSON.parse(await readFile(resolve(dir, 'subjects.json'), 'utf8'));
const html = async (name) =>
	(await readFile(resolve(dir, `${name}.html`), 'utf8'))
		.replaceAll('>app.manawg.com<', `>${new URL(appUrl).host}<`)
		.replaceAll('https://app.manawg.com', appUrl)
		.replaceAll('https://manawg.com', legalUrl);

const body = {};
for (const name of ['confirmation', 'recovery', 'magic_link', 'email_change']) {
	body[`mailer_subjects_${name}`] = subjects[name];
	body[`mailer_templates_${name}_content`] = await html(name);
}
// The sign-in code form expects EMAIL_CODE_LENGTH (8) digits; Supabase defaults to 6.
body.mailer_otp_length = 8;
body.mailer_notifications_password_changed_enabled = true;
body.mailer_subjects_password_changed_notification = subjects.password_changed;
body.mailer_templates_password_changed_notification_content = await html('password_changed');

log(`${apply ? 'APPLY' : 'DRY-RUN'} -> PATCH /v1/projects/${ref}/config/auth`);
for (const [k, v] of Object.entries(body)) {
	log(`  ${k}: ${typeof v === 'string' ? `${v.length} chars` : v}`);
}
if (!apply) {
	log('Nothing sent. Re-run with --apply to push.');
	process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
	console.error('SUPABASE_ACCESS_TOKEN is not set.');
	process.exit(1);
}
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
	method: 'PATCH',
	headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
});
if (!res.ok) {
	console.error(`HTTP ${res.status}: ${await res.text()}`);
	process.exit(1);
}
log(`HTTP ${res.status} OK`);

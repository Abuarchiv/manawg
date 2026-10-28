// Pushes the Auth mail templates in supabase/templates/ and the 8-digit sign-in code length to the
// Supabase project given by --ref. The Docker stack renders the same templates itself in
// apps/web/scripts/selfhost/setup.mjs.
// Usage: node scripts/supabase-auth-templates.mjs --ref <ref> --app-url <url> --legal-url <url> [--apply]
// --app-url and --legal-url replace the official origins in the templates: the origin of your app
// and of the site with your imprint and privacy policy. Without --apply this is a dry run that
// prints what would be sent. --apply needs SUPABASE_ACCESS_TOKEN (Supabase dashboard > Account >
// Access Tokens).
// The templates and subjects hold German and English text in `{{ if eq .Data.locale "en" }}` blocks;
// Supabase Auth picks the branch from the user's `user_metadata.locale`, German by default.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderTemplate } from '../supabase/templates/render.mjs';

const log = (line) => process.stdout.write(`${line}\n`);

const dir = resolve(import.meta.dirname, '../supabase/templates');
const args = process.argv.slice(2);
// A flag without a value, or followed by another flag, counts as missing.
const option = (name) => {
	const index = args.indexOf(name);
	const value = index >= 0 ? args[index + 1] : undefined;
	return value && !value.startsWith('--') ? value : undefined;
};
const ref = option('--ref');
const appUrlOption = option('--app-url');
const legalUrlOption = option('--legal-url');
if (!ref || !appUrlOption || !legalUrlOption) {
	console.error(
		[
			'Usage: node scripts/supabase-auth-templates.mjs --ref <project-ref> --app-url <url> --legal-url <url> [--apply]',
			'  --ref        Supabase dashboard: Project Settings > General',
			'  --app-url    origin of your app, e.g. https://wg.example.com',
			'  --legal-url  origin of the site with your imprint and privacy policy',
		].join('\n'),
	);
	process.exit(1);
}
const appUrl = new URL(appUrlOption).origin;
const legalUrl = new URL(legalUrlOption).origin;
const apply = args.includes('--apply');

const subjects = JSON.parse(await readFile(resolve(dir, 'subjects.json'), 'utf8'));
const html = async (name) =>
	renderTemplate(await readFile(resolve(dir, `${name}.html`), 'utf8'), appUrl, legalUrl);

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
log(`  app url: ${appUrl}`);
log(`  legal url: ${legalUrl}`);
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

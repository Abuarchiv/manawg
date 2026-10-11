// Pushes supabase/templates/* to the hosted Supabase Auth config.
// Usage: node scripts/supabase-auth-templates.mjs [--ref <ref>] [--apply]
// Without --apply: dry-run (prints what would be sent). --apply needs SUPABASE_ACCESS_TOKEN.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const log = (line) => process.stdout.write(`${line}\n`);

const dir = resolve(import.meta.dirname, '../supabase/templates');
const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const ref = refIdx >= 0 ? args[refIdx + 1] : 'bwsvsvfgbrsonepffqff';
const apply = args.includes('--apply');

const subjects = JSON.parse(await readFile(resolve(dir, 'subjects.json'), 'utf8'));
const html = async (name) => readFile(resolve(dir, `${name}.html`), 'utf8');

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

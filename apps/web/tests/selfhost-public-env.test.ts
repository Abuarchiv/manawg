import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceAll, replacements } from '../scripts/selfhost/public-env.mjs';

const built = [
	'const a="https://app.manawg-selfhost.invalid";',
	'fetch("https://supabase.manawg-selfhost.invalid/auth/v1")',
	'host:"app.manawg-selfhost.invalid"',
	'key:"manawg-selfhost-publishable-key"',
	'legal:"https://legal.manawg-selfhost.invalid/impressum"',
	'mail:"support@manawg-selfhost.invalid"',
].join('\n');

test('placeholders become the values of this instance', () => {
	const out = replaceAll(
		built,
		replacements({
			NEXT_PUBLIC_APP_URL: 'https://wg.example.com/',
			NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-jwt',
			NEXT_PUBLIC_LEGAL_URL: 'https://example.com',
			NEXT_PUBLIC_SUPPORT_EMAIL: 'admin@example.com',
		}),
	);
	assert.equal(
		out,
		[
			'const a="https://wg.example.com";',
			'fetch("https://wg.example.com/auth/v1")',
			'host:"wg.example.com"',
			'key:"anon-jwt"',
			'legal:"https://example.com/impressum"',
			'mail:"admin@example.com"',
		].join('\n'),
	);
});

test('empty optional values fall back to the defaults the code uses', () => {
	const out = replaceAll(
		built,
		replacements({
			NEXT_PUBLIC_APP_URL: 'http://localhost',
			NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k',
			SMTP_ADMIN_EMAIL: 'noreply@wg.example.com',
		}),
	);
	assert.match(out, /legal:"https:\/\/manawg\.com\/impressum"/);
	// Error reports stay on the instance: its sender address, never the ManaWG maintainers.
	assert.match(out, /mail:"noreply@wg\.example\.com"/);
	assert.match(out, /fetch\("http:\/\/localhost\/auth\/v1"\)/);
	assert.throws(() => replacements({}), /NEXT_PUBLIC_APP_URL is not set/);
});

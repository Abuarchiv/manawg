import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailTransport } from './transport';

test('a configured SMTP host sends over SMTP, also without Vercel production', () => {
	assert.equal(createMailTransport({ SMTP_HOST: 'mailpit', SMTP_PORT: '1025' }).name, 'smtp');
	assert.equal(
		createMailTransport({ SMTP_HOST: 'smtp.example.com', VERCEL_ENV: 'production' }).name,
		'smtp',
	);
});

test('without SMTP the Resend rules stay as they were', () => {
	assert.equal(createMailTransport({}).name, 'dry-run');
	assert.equal(createMailTransport({ RESEND_API_KEY: 're_test' }).name, 'dry-run');
	assert.equal(
		createMailTransport({ RESEND_API_KEY: 're_test', VERCEL_ENV: 'production' }).name,
		'resend',
	);
	assert.throws(() => createMailTransport({ VERCEL_ENV: 'production' }), /RESEND_API_KEY/);
});

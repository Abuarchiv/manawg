import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailTransport, smtpOptions } from './transport';

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

test('SMTP requires TLS except for a mail catcher on the local network', () => {
	const relay = smtpOptions({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' });
	assert.equal(relay.port, 587);
	assert.equal(relay.secure, false);
	assert.equal(relay.requireTLS, true);
	assert.deepEqual(relay.auth, { user: 'u', pass: 'p' });

	const implicit = smtpOptions({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465' });
	assert.equal(implicit.secure, true);

	for (const host of ['mailpit', 'localhost', '127.0.0.1']) {
		assert.equal(smtpOptions({ SMTP_HOST: host, SMTP_PORT: '1025' }).requireTLS, false, host);
	}
	assert.throws(
		() => smtpOptions({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'abc' }),
		/SMTP_PORT/,
	);
});

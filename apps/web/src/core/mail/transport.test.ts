import assert from 'node:assert/strict';
import test from 'node:test';
import { createMailTransport, type OutgoingMail, smtpOptions } from './transport';

const FROM = 'ManaWG <noreply@wg.example.com>';
const OFFICIAL = 'https://app.manawg.com';

test('a configured SMTP host sends over SMTP, also without Vercel production', () => {
	assert.equal(
		createMailTransport({ SMTP_HOST: 'mailpit', SMTP_PORT: '1025', STATEMENT_EMAIL_FROM: FROM })
			.name,
		'smtp',
	);
	assert.equal(
		createMailTransport({
			SMTP_HOST: 'smtp.example.com',
			VERCEL_ENV: 'production',
			STATEMENT_EMAIL_FROM: FROM,
		}).name,
		'smtp',
	);
});

test('without SMTP, Resend is used in production or with an allow-list and a key', () => {
	assert.equal(createMailTransport({}).name, 'dry-run');
	assert.equal(createMailTransport({ RESEND_API_KEY: 're_test' }).name, 'dry-run');
	assert.equal(
		createMailTransport({
			RESEND_API_KEY: 're_test',
			VERCEL_ENV: 'production',
			STATEMENT_EMAIL_FROM: FROM,
		}).name,
		'resend',
	);
	assert.throws(() => createMailTransport({ VERCEL_ENV: 'production' }), /RESEND_API_KEY/);
});

test('only the official instance may send from the default sender', () => {
	const resend = { RESEND_API_KEY: 're_test', VERCEL_ENV: 'production' };
	assert.equal(createMailTransport({ ...resend, NEXT_PUBLIC_APP_URL: OFFICIAL }).name, 'resend');
	assert.equal(
		createMailTransport({ SMTP_HOST: 'mailpit', NEXT_PUBLIC_APP_URL: OFFICIAL }).name,
		'smtp',
	);
	for (const NEXT_PUBLIC_APP_URL of [undefined, '', 'https://wg.example.com']) {
		assert.throws(
			() => createMailTransport({ ...resend, NEXT_PUBLIC_APP_URL }),
			/STATEMENT_EMAIL_FROM is not set/,
		);
		assert.throws(
			() => createMailTransport({ SMTP_HOST: 'mailpit', NEXT_PUBLIC_APP_URL }),
			/STATEMENT_EMAIL_FROM is not set/,
		);
	}
	// A dry run sends nothing, so it needs no sender.
	assert.equal(
		createMailTransport({ NEXT_PUBLIC_APP_URL: 'https://wg.example.com' }).name,
		'dry-run',
	);
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

const mail = (id: string): OutgoingMail => ({
	ledgerId: id,
	attempt: 1,
	to: `${id}@example.org`,
	subject: 's',
	html: '<p>x</p>',
	text: 'x',
});

test('a rejected batch is resent one by one only within the time budget', async (t) => {
	const realNow = Date.now.bind(Date);
	let offset = 0;
	t.mock.method(Date, 'now', () => realNow() + offset);
	const sizes: number[] = [];
	t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
		const size = JSON.parse(String(init.body)).length;
		sizes.push(size);
		if (size > 1) return Response.json({ message: 'invalid' }, { status: 422 });
		offset += 41_000;
		return Response.json({ data: [{ id: `p${sizes.length}` }] });
	});
	const transport = createMailTransport({
		VERCEL_ENV: 'production',
		RESEND_API_KEY: 're_test',
		STATEMENT_EMAIL_FROM: FROM,
	});
	const outcomes = await transport.sendBatch([mail('a'), mail('b'), mail('c')]);
	assert.deepEqual(
		outcomes.map((outcome) => outcome.kind),
		['sent', 'deferred', 'deferred'],
	);
	assert.deepEqual(sizes, [3, 1]);
});

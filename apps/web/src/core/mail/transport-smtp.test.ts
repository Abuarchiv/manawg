import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const failure = { current: new Error('unset') };
mock.module('nodemailer', {
	defaultExport: {
		createTransport: () => ({
			sendMail: async () => {
				throw failure.current;
			},
		}),
	},
});
const { createMailTransport } = await import('./transport');

const mail = {
	ledgerId: 'a',
	attempt: 1,
	to: 'a@example.org',
	subject: 's',
	html: '<p>x</p>',
	text: 'x',
};

async function outcomeFor(error: Error) {
	failure.current = error;
	const transport = createMailTransport({
		SMTP_HOST: 'mailpit',
		STATEMENT_EMAIL_FROM: 'ManaWG <noreply@wg.example.com>',
	});
	const [outcome] = await transport.sendBatch([mail]);
	return outcome;
}

test('an SMTP socket timeout is unconfirmed, a connect timeout stays retryable', async () => {
	const socket = Object.assign(new Error('Timeout'), {
		code: 'ETIMEDOUT',
		timeoutType: 'SOCKET_TIMEOUT',
	});
	assert.deepEqual(await outcomeFor(socket), {
		kind: 'failed',
		error: 'smtp_ETIMEDOUT',
		unconfirmed: true,
	});
	const connect = Object.assign(new Error('Timeout'), {
		code: 'ETIMEDOUT',
		timeoutType: 'CONNECT_TIMEOUT',
	});
	assert.deepEqual(await outcomeFor(connect), { kind: 'failed', error: 'smtp_ETIMEDOUT' });
});

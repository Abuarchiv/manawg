import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const failure = { current: new Error('unset') as Error | null };
const sentOptions: Array<Record<string, unknown>> = [];
mock.module('nodemailer', {
	defaultExport: {
		createTransport: () => ({
			sendMail: async (options: Record<string, unknown>) => {
				sentOptions.push(options);
				if (failure.current) throw failure.current;
				return { messageId: '<id@example>' };
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

test('SMTP hands attachments to the message as buffers', async () => {
	failure.current = null;
	const transport = createMailTransport({
		SMTP_HOST: 'mailpit',
		STATEMENT_EMAIL_FROM: 'ManaWG <noreply@wg.example.com>',
	});
	const attachments = [
		{
			filename: 'a.pdf',
			content: new Uint8Array([37, 80, 68, 70]),
			contentType: 'application/pdf',
		},
	];
	const outcomes = await transport.sendBatch([mail, { ...mail, attachments }]);
	assert.deepEqual(outcomes, [
		{ kind: 'sent', providerId: '<id@example>' },
		{ kind: 'sent', providerId: '<id@example>' },
	]);
	assert.equal('attachments' in (sentOptions.at(-2) ?? {}), false);
	assert.deepEqual(sentOptions.at(-1)?.attachments, [
		{ filename: 'a.pdf', content: Buffer.from([37, 80, 68, 70]), contentType: 'application/pdf' },
	]);
});

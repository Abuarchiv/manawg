import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import type { MailTransport } from './transport';

let inserts = 0;
const insertChain = {
	values: () => insertChain,
	onConflictDoUpdate: () => insertChain,
	returning: async () => [{ id: 'ledger-1', attempts: 0 }],
};

mock.module('@/core/db', {
	namedExports: {
		db: {
			insert: () => {
				inserts += 1;
				return insertChain;
			},
			update: () => ({ set: () => ({ where: async () => [] }) }),
		},
		mailLog: {},
	},
});
const logApiError = mock.fn((_label: string, ..._errors: unknown[]) => undefined);
mock.module('@/core/infra/observability', { namedExports: { logApiError } });
mock.module('drizzle-orm', {
	namedExports: { eq: () => ({}), sql: () => ({}) },
});

const { sendMail } = await import('./send-mail');

const mail = { subject: 's', preheader: 'p', html: '<p>h</p>', text: 'h' };
let batches = 0;
const transport: MailTransport = {
	name: 'dry-run',
	sendBatch: async (mails) => {
		batches += 1;
		return mails.map(() => ({ kind: 'sent' as const, providerId: 'p' }));
	},
};
const input = (to: string) => ({ kind: 'invitation' as const, dedupeKey: `k-${to}`, to, mail });

afterEach(() => {
	delete process.env.STATEMENT_EMAIL_ALLOWLIST;
	inserts = batches = 0;
	logApiError.mock.resetCalls();
});

test('a recipient outside the allowlist is refused before the ledger and the provider', async () => {
	process.env.STATEMENT_EMAIL_ALLOWLIST = 'me@x.de';
	assert.equal(await sendMail(input('stranger@y.de'), transport), 'failed');
	assert.deepEqual([inserts, batches], [0, 0]);
});

test('an allowlisted recipient is mailed whatever its case', async () => {
	process.env.STATEMENT_EMAIL_ALLOWLIST = 'me@x.de';
	assert.equal(await sendMail(input('ME@x.de'), transport), 'sent');
	assert.deepEqual([inserts, batches], [1, 1]);
});

test('without an allowlist every recipient is mailed', async () => {
	assert.equal(await sendMail(input('stranger@y.de'), transport), 'sent');
	assert.equal(batches, 1);
});

const failing = (error: string): MailTransport => ({
	name: 'dry-run',
	sendBatch: async (mails) => mails.map(() => ({ kind: 'failed' as const, error })),
});

test('a failed send logs the failure token without the recipient', async () => {
	assert.equal(await sendMail(input('a@b.test'), failing('smtp_EAUTH')), 'failed');
	assert.equal(logApiError.mock.callCount(), 1);
	const label = String(logApiError.mock.calls[0]?.arguments[0]);
	assert.ok(label.includes('invitation failed reason:smtp_EAUTH'));
	assert.ok(!label.includes('a@b.test'));
});

test('the log keeps the provider status and drops its free text', async () => {
	await sendMail(input('a@b.test'), failing('http_422 Invalid from address'));
	const label = String(logApiError.mock.calls[0]?.arguments[0]);
	assert.ok(label.includes('reason:http_422'));
	assert.ok(!label.includes('Invalid'));
});

test('a sent mail logs nothing', async () => {
	await sendMail(input('a@b.test'), transport);
	assert.equal(logApiError.mock.callCount(), 0);
});

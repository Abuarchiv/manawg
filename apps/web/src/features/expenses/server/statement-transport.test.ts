import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createStatementTransport,
	maskEmail,
	type OutgoingMail,
	readAllowlist,
} from './statement-transport';

const mail = (id: string, attempt = 0): OutgoingMail => ({
	ledgerId: id,
	attempt,
	to: `${id}@example.org`,
	subject: 'September ist abgerechnet',
	html: '<p>x</p>',
	text: 'x',
	unsubscribeUrl: `https://app.manawg.com/api/email/unsubscribe?t=${id}`,
});

function withFetch(
	respond: (url: string, init: RequestInit) => Response,
	run: (calls: Array<{ url: string; init: RequestInit }>) => Promise<void>,
) {
	const original = globalThis.fetch;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return respond(url, init);
	}) as typeof fetch;
	return run(calls).finally(() => {
		globalThis.fetch = original;
	});
}

const SENDER = 'ManaWG <noreply@wg.example.com>';
const production = {
	VERCEL_ENV: 'production',
	RESEND_API_KEY: 're_test',
	STATEMENT_EMAIL_FROM: SENDER,
};

test('outside production or without a key nothing is sent', async () => {
	await withFetch(
		() => new Response('{}'),
		async (calls) => {
			for (const env of [
				{ VERCEL_ENV: 'preview', RESEND_API_KEY: 're_test' },
				{ VERCEL_ENV: 'preview' },
			]) {
				const transport = createStatementTransport(env);
				assert.equal(transport.name, 'dry-run');
				const [outcome] = await transport.sendBatch([mail('a')]);
				assert.equal(outcome?.kind, 'sent');
			}
			assert.equal(calls.length, 0);
		},
	);
});

test('production without a key fails instead of degrading to a dry run', () => {
	assert.throws(() => createStatementTransport({ VERCEL_ENV: 'production' }), /RESEND_API_KEY/);
	assert.throws(
		() => createStatementTransport({ VERCEL_ENV: 'production', RESEND_API_KEY: '  ' }),
		/RESEND_API_KEY/,
	);
});

test('an allow-list lets a preview deployment really send', () => {
	const env = {
		VERCEL_ENV: 'preview',
		RESEND_API_KEY: 're_test',
		STATEMENT_EMAIL_FROM: SENDER,
		STATEMENT_EMAIL_ALLOWLIST: 'A@x.de',
	};
	assert.equal(createStatementTransport(env).name, 'resend');
	assert.deepEqual([...(readAllowlist(env) ?? [])], ['a@x.de']);
	assert.equal(readAllowlist({}), null);
});

test('a batch goes out with unsubscribe headers and an idempotency key tied to the ledger rows', async () => {
	await withFetch(
		() => Response.json({ data: [{ id: 'p1' }, { id: 'p2' }] }),
		async (calls) => {
			const transport = createStatementTransport(production);
			const outcomes = await transport.sendBatch([mail('a'), mail('b')]);
			assert.deepEqual(outcomes, [
				{ kind: 'sent', providerId: 'p1' },
				{ kind: 'sent', providerId: 'p2' },
			]);
			await transport.sendBatch([mail('b'), mail('a')]);
			await transport.sendBatch([mail('a', 1), mail('b')]);
			const keys = calls.map(
				(call) => (call.init.headers as Record<string, string>)['Idempotency-Key'],
			);
			assert.equal(keys[0], keys[1]);
			assert.notEqual(keys[0], keys[2]);
			const headers = calls[0]?.init.headers as Record<string, string>;
			assert.equal(headers.Authorization, 'Bearer re_test');
			const [first] = JSON.parse(String(calls[0]?.init.body));
			assert.equal(first.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
			assert.match(first.headers['List-Unsubscribe'], /^<https:\/\/app\.manawg\.com\//);
		},
	);
});

test('429 defers the whole batch instead of failing it', async () => {
	await withFetch(
		() => Response.json({ name: 'rate_limit_exceeded', message: 'slow down' }, { status: 429 }),
		async () => {
			const outcomes = await createStatementTransport(production).sendBatch([mail('a'), mail('b')]);
			assert.deepEqual(
				outcomes.map((o) => o.kind),
				['deferred', 'deferred'],
			);
		},
	);
});

test('a provider error fails the mails without leaking the address', async () => {
	await withFetch(
		() => Response.json({ message: 'server down' }, { status: 500 }),
		async () => {
			const [outcome] = await createStatementTransport(production).sendBatch([mail('a')]);
			assert.equal(outcome?.kind, 'failed');
			assert.doesNotMatch(JSON.stringify(outcome), /example\.org/);
		},
	);
});

test('a timeout is unconfirmed, a refused connection is a plain failure', async () => {
	const original = globalThis.fetch;
	try {
		for (const [name, unconfirmed] of [
			['TimeoutError', true],
			['TypeError', false],
		] as const) {
			globalThis.fetch = (async () => {
				const error = new Error('boom');
				error.name = name;
				throw error;
			}) as typeof fetch;
			const [outcome] = await createStatementTransport(production).sendBatch([mail('a')]);
			assert.equal(outcome?.kind, 'failed');
			assert.equal(outcome?.kind === 'failed' && Boolean(outcome.unconfirmed), unconfirmed);
		}
	} finally {
		globalThis.fetch = original;
	}
});

test('log lines carry a masked address only', () => {
	assert.equal(maskEmail('lina@posteo.de'), 'l***@posteo.de');
	assert.equal(maskEmail('nonsense'), '***');
});

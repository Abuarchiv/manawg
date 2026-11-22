import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import { connect } from 'node:net';
import { after, before, mock, test } from 'node:test';
import { parseWebPushStatusCode } from '../src/core/notifications/web-push-errors.ts';
import { withEnv } from './support/env.ts';

// Contract test against the real `web-push` package: only the database is faked. Every other push
// test mocks `web-push`, so a release that renames or drops the exports runtime code calls would
// pass them all while push silently stops.

const wgMembers = { __table: 'wg_members' };
let subscriptionRows: unknown[] = [];
mock.module('@/core/db', {
	namedExports: {
		wgMembers,
		pushSubscriptions: { __table: 'push_subscriptions' },
		db: {
			select: () => ({
				from: (table: unknown) => ({
					where: async () =>
						table === wgMembers
							? [{ id: 'member-1', pushOptIn: true, quietStartHour: null, quietEndHour: null }]
							: subscriptionRows,
				}),
			}),
		},
	},
});

const webPush = await import('web-push');
const { dispatchNotification } = await import('../src/core/notifications/notification-dispatch.ts');

// web-push always sends over node:https. The plain HTTP server below stands in for the push
// service, so connections to it skip TLS; everything above the socket stays real.
mock.method(https.Agent.prototype, 'createConnection', (options: { host: string; port: number }) =>
	connect(options.port, options.host),
);

interface Received {
	method: string | undefined;
	headers: IncomingHttpHeaders;
	body: Buffer;
}
const received: Received[] = [];
let answer = 201;
const server = createServer((req, res) => {
	const chunks: Buffer[] = [];
	req.on('data', (chunk: Buffer) => chunks.push(chunk));
	req.on('end', () => {
		received.push({ method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
		res.writeHead(answer).end();
	});
});
let endpoint = '';

before(async () => {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	assert.ok(address && typeof address === 'object');
	endpoint = `https://127.0.0.1:${address.port}/push/device-1`;
});
after(() => {
	server.closeAllConnections();
	server.close();
});

// A browser subscription: an uncompressed P-256 public key and a 16-byte auth secret.
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const keys = {
	p256dh: ecdh.getPublicKey().toString('base64url'),
	auth: randomBytes(16).toString('base64url'),
};
const vapid = webPush.generateVAPIDKeys();
const VAPID_ENV = {
	NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
	VAPID_PRIVATE_KEY: vapid.privateKey,
	VAPID_SUBJECT: 'mailto:ops@example.test',
};

test('dispatch sends a VAPID-signed, encrypted push through the real web-push', async () => {
	answer = 201;
	received.length = 0;
	subscriptionRows = [
		{ id: 'sub-1', endpoint, p256dh: keys.p256dh, authKey: keys.auth, createdAt: new Date(0) },
	];
	const result = await withEnv(VAPID_ENV, () =>
		dispatchNotification({
			wg: { id: 'wg-1', name: 'WG', shareCode: 'ABC' },
			event: 'notification.test',
			payload: {},
			targetMemberIds: ['member-1'],
			bypassPreferences: true,
		}),
	);

	assert.deepEqual(result, { sent: 1, failures: [] });
	const [push, ...extra] = received;
	assert.ok(push && extra.length === 0, 'exactly one request reached the push service');
	assert.equal(push.method, 'POST');
	assert.match(String(push.headers.authorization), /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
	assert.match(String(push.headers.ttl), /^\d+$/);
	assert.equal(push.headers['content-encoding'], 'aes128gcm');
	assert.ok(push.body.length > 0);
	assert.ok(!push.body.toString('latin1').includes('"title"'), 'the payload is encrypted');
});

test('a 410 from the push service is an error whose statusCode the dispatch reads', async () => {
	answer = 410;
	webPush.setVapidDetails(VAPID_ENV.VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);
	const err = await webPush.sendNotification({ endpoint, keys }, 'gone').then(
		() => assert.fail('a 410 answer must reject'),
		(error: unknown) => error,
	);
	assert.equal((err as { statusCode?: unknown }).statusCode, 410);
	assert.equal(parseWebPushStatusCode(err), 410);
});

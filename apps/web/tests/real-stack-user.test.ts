import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { applyEnv } from './support/env.ts';

type SignInResponse = { status: number; retryAfter?: string };
type CreatedUser = { ctx: { dispose(): Promise<void> } };

let signInResponses: SignInResponse[] = [];
let signInAttempts: Array<{ body: unknown; at: number }> = [];
let createUser: (name: string) => Promise<CreatedUser>;

const readJson = async (req: IncomingMessage): Promise<unknown> => {
	let body = '';
	for await (const chunk of req) body += chunk;
	return JSON.parse(body);
};

const adminServer = createServer(async (req, res) => {
	if (req.method !== 'POST' || req.url !== '/auth/v1/admin/users') {
		res.writeHead(404).end();
		return;
	}
	await readJson(req);
	res.writeHead(201, { 'content-type': 'application/json' });
	res.end(JSON.stringify({ id: 'fake-user-id' }));
});

const appServer = createServer(async (req, res) => {
	if (req.method !== 'POST' || req.url !== '/api/auth/sign-in') {
		res.writeHead(404).end();
		return;
	}
	signInAttempts.push({ body: await readJson(req), at: Date.now() });
	const response = signInResponses.shift() ?? { status: 500 };
	res.writeHead(response.status, {
		'content-type': 'application/json',
		...(response.retryAfter === undefined ? {} : { 'retry-after': response.retryAfter }),
	});
	res.end('{}');
});

const listen = async (server: Server): Promise<string> => {
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert(address && typeof address !== 'string');
	return `http://127.0.0.1:${address.port}`;
};

const close = (server: Server) =>
	new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});

before(async () => {
	const [supabaseUrl, appUrl] = await Promise.all([listen(adminServer), listen(appServer)]);
	const restore = applyEnv({
		CRON_SECRET: 'fake-cron-secret',
		REAL_STACK_APP_URL: appUrl,
		REAL_STACK_DATABASE_URL: 'postgresql://fake:fake@127.0.0.1:1/fake',
		REAL_STACK_MAILPIT_URL: 'http://127.0.0.1:1',
		REAL_STACK_SUPABASE_URL: supabaseUrl,
		SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
	});
	try {
		({ user: createUser } = await import('../scripts/real-stack/modules-lib.mjs'));
	} finally {
		restore();
	}
});

after(async () => {
	await Promise.all([close(adminServer), close(appServer)]);
});

beforeEach(() => {
	signInResponses = [];
	signInAttempts = [];
});

test('retries one numeric Retry-After 429 with the same credentials after waiting', async () => {
	signInResponses = [{ status: 429, retryAfter: '1' }, { status: 200 }];
	const result = await createUser('Retry');
	try {
		assert.equal(signInAttempts.length, 2);
		const [first, second] = signInAttempts;
		assert.ok(first && second);
		assert.deepEqual(first.body, second.body);
		assert.ok(second.at - first.at >= 900);
	} finally {
		await result.ctx.dispose();
	}
});

test('stops after one retry when a second 429 has Retry-After zero', async () => {
	signInResponses = [
		{ status: 429, retryAfter: '0' },
		{ status: 429, retryAfter: '0' },
		{ status: 200 },
	];
	await assert.rejects(createUser('Persistent'), /signin Persistent 429/);
	assert.equal(signInAttempts.length, 2);
	const [first, second] = signInAttempts;
	assert.ok(first && second);
	assert.deepEqual(first.body, second.body);
});

test('does not retry a 401 response', async () => {
	signInResponses = [{ status: 401, retryAfter: '0' }, { status: 200 }];
	await assert.rejects(createUser('Unauthorized'), /signin Unauthorized 401/);
	assert.equal(signInAttempts.length, 1);
});

test('does not retry a 429 with a malformed Retry-After header', async () => {
	signInResponses = [{ status: 429, retryAfter: 'later' }, { status: 200 }];
	await assert.rejects(createUser('Malformed'), /signin Malformed 429/);
	assert.equal(signInAttempts.length, 1);
});

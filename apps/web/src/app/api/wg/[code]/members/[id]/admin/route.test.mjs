import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');
const routeFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'route.ts');
const readJson = await import(path.join(process.cwd(), 'src/core/http/read-json.ts'));
const wgId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const targetId = '44444444-4444-4444-8444-444444444444';

function harness({
	actorRole = 'admin',
	target = { id: targetId, name: 'Mira', deactivatedAt: null, authUserId: 'auth-2' },
} = {}) {
	const state = { updates: [], audits: [] };
	const wgMembers = {
		id: 'id',
		name: 'name',
		wgId: 'wgId',
		deactivatedAt: 'deactivatedAt',
		role: 'role',
	};
	const json = (body, status) => Response.json(body, { status });
	const tx = {
		select: () => ({
			from: () => ({ where: () => ({ for: async () => (target ? [target] : []) }) }),
		}),
		update: () => ({
			set: (values) => ({
				where: async ([, id]) => {
					state.updates.push({ id, role: values.role });
				},
			}),
		}),
	};
	const mocks = {
		'@/core/audit': { recordAuditEvent: async (e) => state.audits.push(e) },
		'@/core/db': { wgMembers },
		'@/core/db/account-deletion': {
			lockActiveAccountMember: async () => ({ id: adminId, role: actorRole }),
		},
		'@/core/errors': {
			badRequest: (error) => json({ error }, 400),
			conflict: (error) => json({ error }, 409),
			forbidden: (error) => json({ error }, 403),
			notFound: (error) => json({ error }, 404),
			payloadTooLarge: () => json({ error: 'payload_too_large' }, 413),
		},
		'@/core/http/read-json': readJson,
		'@/core/guards/api-auth': { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
		'@/core/guards/require-wg-admin': {
			requireWgAdmin: async () => ({
				ok: true,
				wg: { id: wgId },
				member: { memberId: adminId, name: 'Ada', verified: true },
				authUserId: 'auth-1',
			}),
		},
		'@/core/guards/with-wg-route': {
			withWgRoute: (_label, handler) => (req, ctx) => handler(req, ctx),
		},
		'@/features/expenses/expense-payments': { withExpensePaymentLock: async (_id, fn) => fn(tx) },
		'drizzle-orm': { and: (...p) => p, eq: (...p) => p },
		'next/server': { NextResponse: { json: (body) => Response.json(body) } },
	};
	const compiled = transpileModule(readFileSync(routeFile, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	const post = (id, body = '{}') =>
		module.exports.POST(new Request('https://example.invalid/x', { method: 'POST', body }), {
			code: 'MTE8PZAT',
			id,
		});
	return { post, state };
}

test('hands the admin role to an active member and audits it', async () => {
	const { post, state } = harness();
	const res = await post(targetId);
	assert.equal(res.status, 200);
	assert.deepEqual(state.updates, [
		{ id: adminId, role: 'member' },
		{ id: targetId, role: 'admin' },
	]);
	assert.equal(state.audits[0].eventType, 'member.admin_transferred');
});

test('rejects inactive, unlinked, missing, self and non-admin-actor targets without writes', async () => {
	for (const [opts, id, status] of [
		[{ target: { id: targetId, name: 'M', deactivatedAt: new Date() } }, targetId, 409],
		[{ target: { id: targetId, name: 'M', deactivatedAt: null, authUserId: null } }, targetId, 409],
		[{ target: null }, targetId, 404],
		[{}, adminId, 400],
		[{ actorRole: 'member' }, targetId, 403],
	]) {
		const { post, state } = harness(opts);
		assert.equal((await post(id)).status, status);
		assert.equal(state.updates.length, 0);
	}
});

test('oversized body is rejected', async () => {
	const { post } = harness();
	assert.equal((await post(targetId, JSON.stringify({ x: 'a'.repeat(2000) }))).status, 413);
});

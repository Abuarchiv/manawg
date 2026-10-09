import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { loadParseBody } from '../../../../../../../tests/support/claimed-response.cjs';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const routeFile = path.join(process.cwd(), 'src/app/api/wg/[code]/chores/[id]/route.ts');
const choreId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const otherWgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memberId = '33333333-3333-4333-8333-333333333333';

function json(body, status = 200) {
	return Response.json(body, { status });
}

function makeRoute(state) {
	const chores = { id: 'chores.id', wgId: 'chores.wg_id' };
	const wgMembers = { id: 'wm.id', wgId: 'wm.wg_id', deactivatedAt: 'wm.deactivated_at' };
	const announcements = {
		wgId: 'a.wg_id',
		status: 'a.status',
		source: 'a.source',
		sourcePath: 'a.source_path',
	};
	const db = {
		update: (table) => ({
			set: (values) => ({
				where: (conditions) => {
					const call = { table, values, conditions };
					state.updates.push(call);
					const result = table === chores ? [{ ...state.rows[0], ...call.values }] : [];
					return Object.assign(Promise.resolve(result), { returning: async () => result });
				},
			}),
		}),
		select: () => ({
			from: (table) => ({
				where: (conditions) => ({
					limit: async (limit) => {
						state.queries.push({ table, conditions, limit });
						if (table === wgMembers) return state.members;
						const filters = new Map(conditions.map(({ column, value }) => [column, value]));
						return state.rows
							.filter(
								(row) => row.id === filters.get(chores.id) && row.wgId === filters.get(chores.wgId),
							)
							.slice(0, limit);
					},
				}),
			}),
		}),
	};
	const overrides = {
		'@/core/audit': { recordAuditEvent: async () => undefined },
		'@/core/db': {
			CHORE_RECURRENCE_TYPES: ['days', 'months'],
			announcements,
			chores,
			db,
			wgMembers,
		},
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/http/api-errors': {
			badRequest: (code) => json({ error: code }, 400),
			conflict: (code) => json({ error: code }, 409),
			forbidden: (code) => json({ error: code }, 403),
			notFound: (code) => json({ error: code }, 404),
			tooMany: (code) => json({ error: code }, 429),
		},
		'@/core/db/transaction': { withTransaction: async (operation) => operation(db) },
		'@/core/guards/admin': { isWgAdmin: () => true },
		'@/core/guards/api-auth': {
			UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async (_request, code) => {
				state.authCalls.push(code);
				return state.auth;
			},
		},
		'@/core/guards/with-wg-route': {
			withWgRoute: (_label, handler) => async (request, context) =>
				handler(request, await context.params),
		},
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
		'@/features/chores/chore-patch': { buildChorePatchUpdate: () => ({}) },
		'drizzle-orm': {
			and: (...conditions) => conditions,
			eq: (column, value) => ({ column, value }),
			isNull: (column) => ({ column, value: null }),
			sql: (parts, ...values) => ({ parts, values }),
		},
		'next/server': { NextResponse: { json } },
	};
	overrides['@/core/http/parse-body'] = loadParseBody(overrides);
	const compiled = transpileModule(readFileSync(routeFile, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const routeModule = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(overrides, name) ? overrides[name] : requireFromWeb(name)),
		routeModule,
		routeModule.exports,
	);
	return { get: routeModule.exports.GET, patch: routeModule.exports.PATCH };
}

function makeState(overrides = {}) {
	return {
		rows: [
			{
				id: choreId,
				wgId,
				title: 'Küche reinigen',
				assignedMemberId: null,
				nextDueAt: new Date('2026-09-27T10:00:00.000Z'),
				intervalDays: 7,
				recurrenceType: 'days',
			},
		],
		auth: { ok: true, wg: { id: wgId }, member: { memberId: choreId, name: 'Alex' } },
		members: [{ id: memberId }],
		authCalls: [],
		queries: [],
		updates: [],
		...overrides,
	};
}

function request() {
	return new Request(`https://example.invalid/api/wg/WG123456/chores/${choreId}`);
}

function context(id = choreId) {
	return { params: Promise.resolve({ code: 'WG123456', id }) };
}

test('GET returns the chore needed by the MCP detail reader and scopes by id and WG', async () => {
	const state = makeState();
	const route = makeRoute(state);

	const response = await route.get(request(), context());

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { chore: JSON.parse(JSON.stringify(state.rows[0])) });
	assert.equal(state.authCalls.length, 1);
	assert.deepEqual(
		state.queries[0]?.conditions.map(({ column, value }) => [column, value]),
		[
			['chores.id', choreId],
			['chores.wg_id', wgId],
		],
	);
	assert.equal(state.queries[0]?.limit, 1);
});

test('GET returns not found for a chore id that belongs to another WG', async () => {
	const state = makeState({ rows: [{ ...makeState().rows[0], wgId: otherWgId }] });
	const route = makeRoute(state);

	const response = await route.get(request(), context());

	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: 'chore_not_found' });
	assert.equal(state.queries.length, 1);
});

test('GET requires WG membership before querying chores', async () => {
	const denied = json({ error: 'not_a_member' }, 403);
	const state = makeState({ auth: { ok: false, response: denied } });
	const route = makeRoute(state);

	const response = await route.get(request(), context());

	assert.equal(response.status, 403);
	assert.deepEqual(await response.json(), { error: 'not_a_member' });
	assert.equal(state.queries.length, 0);
});

test('GET rejects a malformed UUID before auth or database access', async () => {
	const state = makeState();
	const route = makeRoute(state);

	const response = await route.get(request(), context('not-a-uuid'));

	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { error: 'id_invalid' });
	assert.equal(state.authCalls.length, 0);
	assert.equal(state.queries.length, 0);
});

function patchRequest(body) {
	return new Request(`https://example.invalid/api/wg/WG123456/chores/${choreId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

test('PATCH to a new assignee resolves the open swap request of that chore', async () => {
	const state = makeState();
	const route = makeRoute(state);

	const response = await route.patch(patchRequest({ assignedMemberId: memberId }), context());

	assert.equal(response.status, 200);
	const swapUpdate = state.updates.find((call) => call.values.status === 'resolved');
	assert.ok(swapUpdate, 'the open chore_swap post is resolved');
	const filters = new Map(swapUpdate.conditions.map(({ column, value }) => [column, value]));
	assert.equal(filters.get('a.source'), 'chore_swap');
	assert.equal(filters.get('a.status'), 'open');
	assert.equal(filters.get('a.wg_id'), wgId);
	assert.equal(filters.get('a.source_path'), `/putzen?highlight=${choreId}`);
});

test('PATCH that keeps the same assignee leaves the swap request open', async () => {
	const state = makeState();
	state.rows[0].assignedMemberId = memberId;
	const route = makeRoute(state);

	const response = await route.patch(patchRequest({ assignedMemberId: memberId }), context());

	assert.equal(response.status, 200);
	assert.equal(
		state.updates.some((call) => call.values.status === 'resolved'),
		false,
	);
});

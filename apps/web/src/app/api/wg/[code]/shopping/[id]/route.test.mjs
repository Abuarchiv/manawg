import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DrizzleQueryError } from 'drizzle-orm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const directory = path.dirname(fileURLToPath(import.meta.url));
const routeFile = path.join(directory, 'route.ts');
const wrapperFile = path.join(process.cwd(), 'src/core/guards/with-wg-route.ts');
const itemId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const shareCode = 'MTE8PZAT';

function json(body, status = 200) {
	return Response.json(body, { status });
}

function harness(returning) {
	const state = { audits: 0, notices: 0, update: null, loggedErrors: [] };
	const shoppingItems = { id: 'shopping_items.id', wgId: 'shopping_items.wg_id' };
	const db = {
		update(table) {
			assert.equal(table, shoppingItems);
			return {
				set(values) {
					state.update = values;
					return {
						where() {
							return { returning };
						},
					};
				},
			};
		},
	};
	const mocks = {
		'@/core/activity-feed': {
			postSystemNotice: async () => {
				state.notices += 1;
			},
		},
		'@/core/audit': {
			recordAuditEvent: async () => {
				state.audits += 1;
			},
		},
		'@/core/db': { db, shoppingItems },
		'@/core/errors': {
			badRequest: (error) => json({ error }, 400),
			conflict: (error) => json({ error }, 409),
			forbidden: (error) => json({ error }, 403),
			notFound: (error) => json({ error }, 404),
			serverError: () => json({ error: 'server_error' }, 500),
			tooMany: (error) => json({ error }, 429),
		},
		'@/core/guards/api-auth': { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: wgId },
				member: { memberId, name: 'Alex', verified: true },
			}),
		},
		'@/core/guards/route-preamble': {
			readShareCode: async (ctx) => ({ ok: true, ...(await ctx.params) }),
			resolveE2EFixture: async () => ({ mode: 'none' }),
		},
		'@/core/infra/observability': {
			logApiError: (_label, error) => state.loggedErrors.push(error),
		},
		'@/core/rate-limit': {
			checkRateLimit: async () => ({ success: true }),
			wgWriteLimiter: {},
		},
		'drizzle-orm': { and: (...conditions) => conditions, eq: (...condition) => condition },
		'next/server': { NextResponse: { json } },
	};

	const cache = new Map();
	function loadTypeScript(file) {
		if (cache.has(file)) return cache.get(file).exports;
		const compiled = transpileModule(readFileSync(file, 'utf8'), {
			compilerOptions: {
				esModuleInterop: true,
				module: ModuleKind.CommonJS,
				target: ScriptTarget.ES2022,
			},
		}).outputText;
		const module = { exports: {} };
		cache.set(file, module);
		const mockRequire = (name) => {
			if (name === '@/core/guards/with-wg-route') return loadTypeScript(wrapperFile);
			if (name === '@/features/shopping/shopping-duplicate') {
				return loadTypeScript(
					path.join(process.cwd(), 'src/features/shopping/shopping-duplicate.ts'),
				);
			}
			if (Object.hasOwn(mocks, name)) return mocks[name];
			return requireFromWeb(name);
		};
		new Function('require', 'module', 'exports', compiled)(mockRequire, module, module.exports);
		return module.exports;
	}

	const route = loadTypeScript(routeFile);
	return {
		state,
		patch: () =>
			route.PATCH(
				new Request(`https://example.invalid/api/wg/${shareCode}/shopping/${itemId}`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ bought: false }),
				}),
				{ params: Promise.resolve({ code: shareCode, id: itemId }) },
			),
	};
}

test('reopening an item that conflicts with another open name returns 409', async () => {
	const postgresError = Object.assign(new Error('duplicate key value violates unique constraint'), {
		code: '23505',
		constraint: 'shopping_items_unique_open_name',
	});
	const duplicateError = new DrizzleQueryError(
		'update shopping_items set bought_at = null',
		[],
		postgresError,
	);
	const { patch, state } = harness(async () => {
		throw duplicateError;
	});

	const response = await patch();

	assert.deepEqual(await response.json(), { error: 'shopping_item_duplicate' });
	assert.equal(response.status, 409);
	assert.deepEqual(state.update, {
		boughtAt: null,
		boughtByMemberId: null,
		updatedAt: state.update.updatedAt,
	});
	assert.equal(state.audits, 0);
	assert.equal(state.notices, 0);
});

test('other database errors still use the shared 500 handler', async () => {
	const postgresError = Object.assign(new Error('different constraint'), {
		code: '23505',
		constraint: 'shopping_items_other_unique_key',
	});
	const queryError = new DrizzleQueryError('update shopping_items', [], postgresError);
	const { patch, state } = harness(async () => {
		throw queryError;
	});

	const response = await patch();

	assert.equal(response.status, 500);
	assert.deepEqual(await response.json(), { error: 'server_error' });
	assert.equal(state.loggedErrors[0], queryError);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

function loadTs(file, overrides = {}) {
	const source = transpileModule(readFileSync(path.join(process.cwd(), file), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', source)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

function exportRoute(failedTable) {
	const tables = Object.fromEntries(
		[
			'announcements',
			'auditEvents',
			'chores',
			'expenseSplits',
			'expenses',
			'memberAbsences',
			'recurringExpenses',
			'shoppingItems',
			'wgMembers',
		].map((name) => [name, {}]),
	);
	const limits = [];
	const db = {
		select: () => ({
			from: (table) => {
				const rows =
					table === tables[failedTable]
						? Promise.reject(new Error('privateDbPassword123'))
						: Promise.resolve([]);
				const query = Object.assign(rows, {
					where: () => query,
					orderBy: () => query,
					limit: (limit) => {
						limits.push(limit);
						return query;
					},
					offset: () => query,
				});
				return query;
			},
		}),
	};
	const { GET } = loadTs('src/app/api/wg/[code]/export/route.ts', {
		'@/core/db': { db, ...tables },
		'@/core/errors': {
			badRequest: (error) => Response.json({ error }, { status: 400 }),
			serverError: (_error, message) => Response.json({ error: message }, { status: 500 }),
			tooMany: () => new Response(null, { status: 429 }),
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
				member: { memberId: 'member' },
			}),
		},
		'@/core/guards/route-preamble': {
			readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
			resolveE2EFixture: async () => ({ mode: 'real' }),
		},
		'@/core/infra/observability': loadTs('src/core/infra/observability.ts'),
		'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }) },
		'@/core/reads/export': loadTs('src/core/reads/export.ts'),
		'drizzle-orm': { asc: () => null, desc: () => null, eq: () => null, inArray: () => null },
		'next/server': { NextResponse: Response },
	});
	return {
		limits,
		get: (search = '') => GET({ nextUrl: new URL(`https://example.invalid/export${search}`) }, {}),
	};
}

test('authenticated default JSON and CSV exports work without a limit', async () => {
	for (const search of ['', '?format=csv&section=expenses', '?offset=20']) {
		const route = exportRoute();
		const response = await route.get(search);
		assert.equal(response.status, 200, await response.text());
		assert.ok(route.limits.every((limit) => limit === Number.MAX_SAFE_INTEGER));
	}
});

test('explicit export limits remain bounded', async () => {
	const route = exportRoute();
	assert.equal((await route.get('?limit=20')).status, 200);
	assert.ok(route.limits.every((limit) => limit === 20));
	assert.equal((await route.get('?limit=100001')).status, 400);
	assert.equal((await route.get('?limit=0')).status, 400);
});

test('one failed JSON section rejects the incomplete backup', async (t) => {
	const logged = [];
	t.mock.method(console, 'error', (...args) => logged.push(args));
	for (const section of ['expenses', 'wgMembers']) {
		const response = await exportRoute(section).get('?limit=20');
		assert.equal(response.status, 500);
		assert.equal((await response.json()).error, 'export_incomplete');
	}
	assert.equal(JSON.stringify(logged).includes('privateDbPassword123'), false);
});
